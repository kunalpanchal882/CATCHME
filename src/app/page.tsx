"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  formattedTime: string;
  isOptimistic?: boolean;
}

// Generate a random client ID for presence and connection tracking
function generateClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

// Helper to safely access localStorage
function getStoredName(): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem("melody_username");
    }
  } catch (err) {
    console.warn("localStorage not available:", err);
  }
  return null;
}

function setStoredName(name: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("melody_username", name);
    }
  } catch (err) {
    console.warn("Could not write to localStorage:", err);
  }
}

// Synthesized gentle notification chime using Web Audio API (zero external files)
function playGentleChime(): void {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // First note (E5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.04, now);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Second note (B5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(987.77, now + 0.08);
    gain2.gain.setValueAtTime(0.05, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.45);
  } catch {
    // Audio context may be restricted by autoplay policy until user gesture
  }
}

export default function MelodyChatApp() {
  // User state
  const [username, setUsername] = useState<string>("");
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [nameInput, setNameInput] = useState<string>("");
  const [nameError, setNameError] = useState<string>("");
  const [showChangeNameModal, setShowChangeNameModal] = useState<boolean>(false);
  const [newNameInput, setNewNameInput] = useState<string>("");
  const [changeNameError, setChangeNameError] = useState<string>("");

  // Chat & Connection state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [onlineCount, setOnlineCount] = useState<number>(1);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "reconnecting">("connected");
  const [rateLimitWarning, setRateLimitWarning] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showScrollBottomPill, setShowScrollBottomPill] = useState<boolean>(false);

  // References
  const clientIdRef = useRef<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isUserScrolledUpRef = useRef<boolean>(false);
  const lastMessageIdRef = useRef<string>("");
  const connectSSERef = useRef<() => void>(() => {});

  // Initialize client ID and check for saved name on mount
  useEffect(() => {
    clientIdRef.current = generateClientId();
    const savedName = getStoredName();
    if (savedName && savedName.trim().length >= 2 && savedName.trim().length <= 20) {
      queueMicrotask(() => {
        setUsername(savedName.trim());
        setIsJoined(true);
      });
    }
  }, []);

  // Update lastMessageIdRef whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      lastMessageIdRef.current = messages[messages.length - 1].id;
    }
  }, [messages]);

  // Handle auto-scroll logic
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
      });
      setShowScrollBottomPill(false);
      isUserScrolledUpRef.current = false;
    }
  }, []);

  // Detect whether user has scrolled up
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    // If within 60px of the bottom, considered at bottom
    if (distanceFromBottom > 60) {
      isUserScrolledUpRef.current = true;
    } else {
      isUserScrolledUpRef.current = false;
      setShowScrollBottomPill(false);
    }
  }, []);

  // Connect to SSE with fallback to polling
  const startPolling = useCallback(() => {
    if (pollingTimerRef.current) return;

    pollingTimerRef.current = setInterval(async () => {
      try {
        const sinceId = lastMessageIdRef.current;
        const res = await fetch(
          `/api/messages?sinceId=${encodeURIComponent(sinceId)}&clientId=${encodeURIComponent(clientIdRef.current)}`
        );
        if (!res.ok) throw new Error("Polling error");

        const data = await res.json();
        if (data.success) {
          if (typeof data.onlineCount === "number") {
            setOnlineCount(data.onlineCount);
          }

          if (Array.isArray(data.messages) && data.messages.length > 0) {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const newIncoming = data.messages.filter((m: Message) => !existingIds.has(m.id));

              if (newIncoming.length === 0) return prev;

              // Play chime for other people's messages if sound enabled
              if (soundEnabled && newIncoming.some((m: Message) => m.sender !== username)) {
                playGentleChime();
              }

              // Check if user was scrolled up
              if (isUserScrolledUpRef.current) {
                setShowScrollBottomPill(true);
              } else {
                setTimeout(() => scrollToBottom(true), 50);
              }

              return [...prev, ...newIncoming];
            });
          }
          setConnectionStatus("connected");
        }
      } catch {
        setConnectionStatus("reconnecting");
      }
    }, 2000);
  }, [username, soundEnabled, scrollToBottom]);

  const stopPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  // Establish SSE connection
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sseUrl = `/api/events?clientId=${encodeURIComponent(clientIdRef.current)}`;
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.addEventListener("open", () => {
      setConnectionStatus("connected");
      stopPolling();
    });

    // Handle initial payload
    es.addEventListener("init", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
          if (data.messages.length > 0) {
            lastMessageIdRef.current = data.messages[data.messages.length - 1].id;
          }
          // Scroll to bottom on initial load
          setTimeout(() => scrollToBottom(false), 50);
        }
        if (typeof data.onlineCount === "number") {
          setOnlineCount(data.onlineCount);
        }
      } catch (err) {
        console.error("Failed to parse init data:", err);
      }
    });

    // Handle incoming messages
    es.addEventListener("message", (event: MessageEvent) => {
      try {
        const message: Message = JSON.parse(event.data);

        setMessages((prev) => {
          // Replace any matching optimistic message from this user
          const existingIndex = prev.findIndex(
            (m) => m.id === message.id || (m.isOptimistic && m.sender === message.sender && m.text === message.text)
          );

          if (existingIndex !== -1) {
            const next = [...prev];
            next[existingIndex] = message;
            return next;
          }

          // Sound chime if message is from someone else
          if (soundEnabled && message.sender !== username) {
            playGentleChime();
          }

          // Check if user is scrolled up
          if (isUserScrolledUpRef.current) {
            setShowScrollBottomPill(true);
          } else {
            setTimeout(() => scrollToBottom(true), 50);
          }

          return [...prev, message];
        });
      } catch (err) {
        console.error("Failed to parse message event:", err);
      }
    });

    // Handle presence updates
    es.addEventListener("presence", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data.count === "number") {
          setOnlineCount(data.count);
        }
      } catch (err) {
        console.error("Failed to parse presence:", err);
      }
    });

    // Handle errors / disconnects -> Fallback to polling
    es.onerror = () => {
      setConnectionStatus("reconnecting");
      es.close();
      eventSourceRef.current = null;
      // Start polling fallback every 2 seconds
      startPolling();

      // Retry SSE after 5 seconds
      setTimeout(() => {
        if (!eventSourceRef.current) {
          connectSSERef.current();
        }
      }, 5000);
    };
  }, [username, soundEnabled, scrollToBottom, startPolling, stopPolling]);

  // Keep connectSSERef synchronized
  useEffect(() => {
    connectSSERef.current = connectSSE;
  }, [connectSSE]);

  // Connect when user joins or mounts
  useEffect(() => {
    if (isJoined) {
      connectSSE();
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPolling();
    };
  }, [isJoined, connectSSE, stopPolling]);

  // Handle joining with a display name
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed.length < 2) {
      setNameError("Name must be at least 2 characters.");
      return;
    }
    if (trimmed.length > 20) {
      setNameError("Name cannot exceed 20 characters.");
      return;
    }

    setNameError("");
    setUsername(trimmed);
    setStoredName(trimmed);
    setIsJoined(true);
  };

  // Handle changing display name
  const handleChangeName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newNameInput.trim();
    if (trimmed.length < 2) {
      setChangeNameError("Name must be at least 2 characters.");
      return;
    }
    if (trimmed.length > 20) {
      setChangeNameError("Name cannot exceed 20 characters.");
      return;
    }

    setUsername(trimmed);
    setStoredName(trimmed);
    setShowChangeNameModal(false);
    setChangeNameError("");
  };

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const textToSend = inputText.trim();

    if (!textToSend || isSending) return;
    if (textToSend.length > 500) {
      setRateLimitWarning("Message cannot exceed 500 characters.");
      return;
    }

    setRateLimitWarning("");
    setIsSending(true);

    // Optimistic message
    const tempId = `optimistic-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      sender: username,
      text: textToSend,
      timestamp: Date.now(),
      formattedTime: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      isOptimistic: true,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText("");

    // Auto-scroll on own message
    setTimeout(() => scrollToBottom(true), 30);

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: username,
          text: textToSend,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setRateLimitWarning(result.error || "Please wait 1 second between messages.");
        } else {
          setRateLimitWarning(result.error || "Could not deliver message.");
        }
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setInputText(textToSend); // Restore text so user does not lose it
      } else if (result.success && result.message) {
        // Replace optimistic message with server message
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...result.message, isOptimistic: false } : m))
        );
      }
    } catch {
      setRateLimitWarning("Network issue. Reconnecting...");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInputText(textToSend);
    } finally {
      setIsSending(false);
    }
  };

  // Handle Enter key (Shift+Enter for newline if multiline, otherwise send)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Render Join Screen
  if (!isJoined) {
    return (
      <main className="melody-app" id="join-screen">
        <header className="melody-header">
          <div className="brand-section">
            <div className="logo-badge" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <div className="brand-title-group">
              <span className="brand-name">Melody</span>
              <div className="header-status-row">
                <span>Wi-Fi Hotspot Chat</span>
              </div>
            </div>
          </div>
        </header>

        <section className="join-screen-container">
          <div className="join-card">
            <div className="join-icon-wrap" aria-hidden="true">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>

            <div>
              <h1 className="join-title">Join the Chat</h1>
              <p className="join-subtitle">
                Connect with everyone currently on this Wi-Fi network. No password or email needed.
              </p>
            </div>

            <form onSubmit={handleJoin} className="join-form">
              <div className="input-field-group">
                <label htmlFor="display-name" className="field-label">
                  Your Display Name
                </label>
                <input
                  id="display-name"
                  type="text"
                  className="text-input"
                  placeholder="e.g. Alex, Maya, Traveler..."
                  value={nameInput}
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    if (nameError) setNameError("");
                  }}
                  maxLength={20}
                  autoFocus
                  required
                />
                {nameError ? (
                  <span className="field-error">{nameError}</span>
                ) : (
                  <span className="field-hint">2 to 20 characters</span>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary"
                id="join-chat-button"
                disabled={nameInput.trim().length < 2 || nameInput.trim().length > 20}
              >
                <span>Enter Melody</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </form>

            <p className="join-footer-notice">
              Your name is stored on your device so you won&apos;t have to re-enter it next time.
            </p>
          </div>
        </section>
      </main>
    );
  }

  // Render Chat Room
  return (
    <main className="melody-app" id="chat-screen">
      {/* App Header */}
      <header className="melody-header">
        <div className="brand-section">
          <div className="logo-badge" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="brand-title-group">
            <div className="brand-name">
              <span>Melody</span>
              <span className="brand-badge">Wi-Fi</span>
            </div>
            <div className="header-status-row">
              <span className="status-indicator">
                <span
                  className={`status-dot ${
                    connectionStatus === "connected" ? "pulse" : "reconnecting"
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {connectionStatus === "connected" ? `${onlineCount} online` : "reconnecting..."}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {/* Sound Chime Toggle */}
          <button
            type="button"
            className="btn-header-action btn-icon-only"
            title={soundEnabled ? "Mute notification chime" : "Enable notification chime"}
            aria-label={soundEnabled ? "Mute sound" : "Enable sound"}
            onClick={() => setSoundEnabled((prev) => !prev)}
          >
            {soundEnabled ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>

          {/* Change Name Button */}
          <button
            type="button"
            className="btn-header-action"
            id="change-name-button"
            onClick={() => {
              setNewNameInput(username);
              setChangeNameError("");
              setShowChangeNameModal(true);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>{username}</span>
          </button>
        </div>
      </header>

      {/* Reconnecting Banner */}
      {connectionStatus === "reconnecting" && (
        <div className="reconnecting-banner" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>Connection paused. Reconnecting to Melody...</span>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        className="chat-messages-container"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        id="chat-messages-stream"
      >
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-bubble" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2 className="empty-title">Say hi to everyone! 🎵</h2>
            <p className="empty-subtitle">
              You are the first one in the room. Send a message to start the melody!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender.toLowerCase() === username.toLowerCase();
            return (
              <div
                key={msg.id}
                className={`message-row ${isOwn ? "is-own" : "is-other"}`}
                id={`msg-${msg.id}`}
              >
                {!isOwn && (
                  <div className="message-sender-label">
                    <span className="sender-avatar">
                      {msg.sender.charAt(0).toUpperCase()}
                    </span>
                    <span>{msg.sender}</span>
                  </div>
                )}
                <div className="message-bubble">
                  {/* React safely renders string text nodes without danger of HTML injection */}
                  {msg.text}
                </div>
                <div className="message-meta">
                  {msg.isOptimistic ? (
                    <span className="status-sending">sending...</span>
                  ) : (
                    <span>{msg.formattedTime}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Scroll to Bottom pill */}
      {showScrollBottomPill && (
        <button
          type="button"
          className="scroll-bottom-pill"
          onClick={() => scrollToBottom(true)}
          aria-label="Scroll to newest messages"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
          <span>New messages below</span>
        </button>
      )}

      {/* Input Dock */}
      <footer className="input-dock">
        {rateLimitWarning && (
          <div
            style={{
              fontSize: "12px",
              color: "#EF4444",
              marginBottom: "6px",
              padding: "0 4px",
              fontWeight: 500,
            }}
          >
            {rateLimitWarning}
          </div>
        )}
        <form onSubmit={handleSendMessage} className="input-form">
          <div className="input-wrapper">
            <textarea
              className="chat-input"
              rows={1}
              id="message-input"
              placeholder="Type a message..."
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                if (rateLimitWarning) setRateLimitWarning("");
              }}
              onKeyDown={handleKeyDown}
              maxLength={500}
              aria-label="Message content"
            />
            {inputText.length > 400 && (
              <span
                className={`input-counter ${
                  inputText.length >= 490 ? "warn" : ""
                }`}
              >
                {inputText.length} / 500
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn-send"
            id="send-button"
            disabled={!inputText.trim() || isSending}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </footer>

      {/* Change Name Modal Dialog */}
      {showChangeNameModal && (
        <div className="modal-overlay" onClick={() => setShowChangeNameModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Change Display Name</h2>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setShowChangeNameModal(false)}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleChangeName} className="join-form">
              <div className="input-field-group">
                <label htmlFor="new-name-input" className="field-label">
                  New Display Name
                </label>
                <input
                  id="new-name-input"
                  type="text"
                  className="text-input"
                  value={newNameInput}
                  onChange={(e) => setNewNameInput(e.target.value)}
                  maxLength={20}
                  autoFocus
                  required
                />
                {changeNameError ? (
                  <span className="field-error">{changeNameError}</span>
                ) : (
                  <span className="field-hint">2 to 20 characters</span>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowChangeNameModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1 }}
                  id="save-new-name-button"
                  disabled={newNameInput.trim().length < 2 || newNameInput.trim().length > 20}
                >
                  Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
