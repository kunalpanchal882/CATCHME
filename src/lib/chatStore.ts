/**
 * In-memory Chat Store for Melody
 * Singleton stored on globalThis to persist across Next.js dev server hot-reloads
 * and production Node.js runtime.
 */

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  formattedTime: string;
}

export interface ClientConnection {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  joinedAt: number;
}

// Function to escape HTML to prevent XSS
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Format timestamp to user-friendly "3:42 PM"
export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

class MelodyChatStore {
  private messages: ChatMessage[] = [];
  private sseClients = new Map<string, ClientConnection>();
  private pollingClients = new Map<string, number>(); // clientId -> lastSeen timestamp
  private rateLimits = new Map<string, number>(); // ip/identifier -> lastMessageTimestamp
  private maxStoredMessages = 200;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Add a welcome message if empty
    if (this.messages.length === 0) {
      const now = new Date();
      this.messages.push({
        id: 'welcome-1',
        sender: 'Melody 🎵',
        text: 'Welcome to Melody! Say hi to everyone on this Wi-Fi hotspot.',
        timestamp: now.getTime(),
        formattedTime: formatTime(now),
      });
    }

    // Keep SSE connections alive and prune stale polling clients every 15 seconds
    if (typeof setInterval !== 'undefined') {
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeat();
        this.pruneStaleClients();
      }, 15000);
      if (this.heartbeatInterval && typeof this.heartbeatInterval.unref === 'function') {
        this.heartbeatInterval.unref();
      }
    }
  }

  // Get current active online count (SSE clients + active polling clients within last 10s)
  public getOnlineCount(): number {
    const now = Date.now();
    let pollingActive = 0;
    for (const [, lastSeen] of this.pollingClients.entries()) {
      if (now - lastSeen < 10000) {
        pollingActive++;
      }
    }
    // Each client has unique ID; count SSE plus non-SSE polling clients
    const count = this.sseClients.size + pollingActive;
    return Math.max(1, count); // at least 1 (the current user viewing)
  }

  // Record presence for polling client
  public touchPollingClient(clientId: string): void {
    if (!clientId) return;
    // Don't double count if this client already has an active SSE connection
    if (this.sseClients.has(clientId)) return;

    const hadClient = this.pollingClients.has(clientId);
    this.pollingClients.set(clientId, Date.now());

    if (!hadClient) {
      this.broadcastPresence();
    }
  }

  private pruneStaleClients(): void {
    const now = Date.now();
    let changed = false;
    for (const [clientId, lastSeen] of this.pollingClients.entries()) {
      if (now - lastSeen >= 12000) {
        this.pollingClients.delete(clientId);
        changed = true;
      }
    }
    if (changed) {
      this.broadcastPresence();
    }
  }

  // Register SSE Client
  public addSSEClient(id: string, controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.pollingClients.delete(id); // If it was polling, now it's on SSE
    this.sseClients.set(id, {
      id,
      controller,
      joinedAt: Date.now(),
    });
    this.broadcastPresence();
  }

  // Remove SSE Client
  public removeSSEClient(id: string): void {
    if (this.sseClients.delete(id)) {
      this.broadcastPresence();
    }
  }

  // Heartbeat comment to keep connections alive through proxies / captive portals
  private sendHeartbeat(): void {
    const encoder = new TextEncoder();
    const pingData = encoder.encode(': ping\n\n');
    for (const [id, client] of this.sseClients.entries()) {
      try {
        client.controller.enqueue(pingData);
      } catch {
        this.sseClients.delete(id);
      }
    }
  }

  // Broadcast an SSE event to all connected clients
  private broadcastEvent(eventType: string, data: unknown): void {
    const encoder = new TextEncoder();
    const payload = encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);

    for (const [id, client] of this.sseClients.entries()) {
      try {
        client.controller.enqueue(payload);
      } catch {
        this.sseClients.delete(id);
      }
    }
  }

  // Broadcast presence count to all SSE clients
  public broadcastPresence(): void {
    const count = this.getOnlineCount();
    this.broadcastEvent('presence', { count });
  }

  // Check rate limit: 1 message per second per sender identifier
  public checkRateLimit(identifier: string): { allowed: boolean; waitMs?: number } {
    const now = Date.now();
    const lastTime = this.rateLimits.get(identifier);
    if (lastTime && now - lastTime < 1000) {
      return { allowed: false, waitMs: 1000 - (now - lastTime) };
    }
    this.rateLimits.set(identifier, now);

    // Keep rate limits map clean
    if (this.rateLimits.size > 500) {
      for (const [key, timestamp] of this.rateLimits.entries()) {
        if (now - timestamp > 10000) {
          this.rateLimits.delete(key);
        }
      }
    }

    return { allowed: true };
  }

  // Add new message
  public addMessage(sender: string, rawText: string): { success: boolean; message?: ChatMessage; error?: string } {
    const cleanSender = sender.trim();
    const cleanText = rawText.trim();

    if (!cleanSender || cleanSender.length < 2 || cleanSender.length > 20) {
      return { success: false, error: 'Name must be between 2 and 20 characters.' };
    }

    if (!cleanText || cleanText.length === 0) {
      return { success: false, error: 'Message cannot be empty.' };
    }

    if (cleanText.length > 500) {
      return { success: false, error: 'Message cannot exceed 500 characters.' };
    }

    const now = new Date();
    const message: ChatMessage = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
      sender: cleanSender,
      text: cleanText,
      timestamp: now.getTime(),
      formattedTime: formatTime(now),
    };

    this.messages.push(message);

    // Keep last maxStoredMessages
    if (this.messages.length > this.maxStoredMessages) {
      this.messages = this.messages.slice(this.messages.length - this.maxStoredMessages);
    }

    // Broadcast immediately to SSE clients
    this.broadcastEvent('message', message);

    return { success: true, message };
  }

  // Retrieve last N messages (default 100)
  public getLastMessages(limit: number = 100): ChatMessage[] {
    const safeLimit = Math.min(Math.max(1, limit), this.maxStoredMessages);
    return this.messages.slice(-safeLimit);
  }

  // Retrieve messages after a given message ID (for polling)
  public getMessagesSince(sinceId?: string | null): ChatMessage[] {
    if (!sinceId) {
      return this.getLastMessages(100);
    }
    const index = this.messages.findIndex((m) => m.id === sinceId);
    if (index === -1) {
      return this.getLastMessages(100);
    }
    return this.messages.slice(index + 1);
  }
}

// Preserve instance across Next.js dev server reloads
const globalForChat = globalThis as unknown as {
  __melodyChatStore?: MelodyChatStore;
};

export const chatStore = globalForChat.__melodyChatStore || new MelodyChatStore();

if (process.env.NODE_ENV !== 'production') {
  globalForChat.__melodyChatStore = chatStore;
}
