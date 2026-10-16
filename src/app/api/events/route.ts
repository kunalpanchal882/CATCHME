import { NextRequest } from 'next/server';
import { chatStore } from '@/lib/chatStore';


export async function GET(req: NextRequest) {
  const clientId =
    req.nextUrl.searchParams.get('clientId') ||
    `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;

  const encoder = new TextEncoder();
  let registered = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chatStore.addSSEClient(clientId, controller);
      registered = true;

      // Send initial data to client: last 100 messages and current online count
      const initialData = {
        messages: chatStore.getLastMessages(100),
        onlineCount: chatStore.getOnlineCount(),
      };

      const payload = encoder.encode(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`);
      controller.enqueue(payload);
    },
    cancel() {
      if (registered) {
        chatStore.removeSSEClient(clientId);
        registered = false;
      }
    },
  });

  // Handle connection close / abort
  req.signal.addEventListener('abort', () => {
    if (registered) {
      chatStore.removeSSEClient(clientId);
      registered = false;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
