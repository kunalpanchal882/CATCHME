import { NextRequest, NextResponse } from 'next/server';
import { chatStore } from '@/lib/chatStore';


// GET /api/messages - Fallback polling endpoint
export async function GET(req: NextRequest) {
  const sinceId = req.nextUrl.searchParams.get('sinceId');
  const clientId = req.nextUrl.searchParams.get('clientId');

  if (clientId) {
    chatStore.touchPollingClient(clientId);
  }

  const messages = chatStore.getMessagesSince(sinceId);
  const onlineCount = chatStore.getOnlineCount();

  return NextResponse.json({
    success: true,
    messages,
    onlineCount,
  });
}

// POST /api/messages - Post a new message
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sender, text } = body || {};

    if (typeof sender !== 'string' || typeof text !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid message payload.' },
        { status: 400 }
      );
    }

    // Rate Limiting: 1 message per second per user
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'anonymous';
    const rateLimitKey = `${clientIp}-${sender.trim()}`;

    const rateLimit = chatStore.checkRateLimit(rateLimitKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please wait a moment before sending another message.',
          retryAfterMs: rateLimit.waitMs,
        },
        { status: 429 }
      );
    }

    const result = chatStore.addMessage(sender, text);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to process request.' },
      { status: 500 }
    );
  }
}
