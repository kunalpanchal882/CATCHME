/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('http');

async function postMessage(sender, text) {
  const res = await fetch('http://localhost:3000/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender, text }),
  });
  return await res.json();
}

function listenSSE(clientId, onMessage, onPresence) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:3000/api/events?clientId=${clientId}`, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          const lines = part.split('\n');
          let eventType = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6).trim();
            }
          }
          if (dataStr) {
            try {
              const data = JSON.parse(dataStr);
              if (eventType === 'presence') {
                onPresence(data);
              } else if (eventType === 'message') {
                onMessage(data);
              } else if (eventType === 'init') {
                resolve({ req, initialData: data });
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      });
    });
  });
}

async function runTwoTabChatTest() {
  console.log('--- Starting Two-Tab Real-Time Chat Simulation ---');

  const tab1Received = [];
  const tab2Received = [];

  // Tab 1 (Maya) connects
  const tab1 = await listenSSE(
    'tab1_maya',
    (msg) => {
      console.log(`[Tab 1 Maya RECEIVED] From ${msg.sender}: "${msg.text}"`);
      tab1Received.push(msg);
    },
    (p) => console.log(`[Tab 1 Presence] ${p.count} online`)
  );
  console.log('✓ Tab 1 (Maya) connected to Melody SSE stream.');

  // Tab 2 (Leo) connects
  const tab2 = await listenSSE(
    'tab2_leo',
    (msg) => {
      console.log(`[Tab 2 Leo RECEIVED] From ${msg.sender}: "${msg.text}"`);
      tab2Received.push(msg);
    },
    (p) => console.log(`[Tab 2 Presence] ${p.count} online`)
  );
  console.log('✓ Tab 2 (Leo) connected to Melody SSE stream.');

  // Small delay for socket sync
  await new Promise((r) => setTimeout(r, 400));

  // Maya sends a message
  console.log('\n[Action] Maya sends: "Hey Leo, welcome to Melody!"');
  const post1 = await postMessage('Maya', 'Hey Leo, welcome to Melody!');
  console.log('Post 1 response:', post1.success ? '✓ Sent successfully' : post1.error);

  await new Promise((r) => setTimeout(r, 600));

  // Leo sends a reply
  console.log('\n[Action] Leo sends: "Thanks Maya! Super smooth Wi-Fi chat 🎵"');
  const post2 = await postMessage('Leo', 'Thanks Maya! Super smooth Wi-Fi chat 🎵');
  console.log('Post 2 response:', post2.success ? '✓ Sent successfully' : post2.error);

  await new Promise((r) => setTimeout(r, 600));

  // Test Polling Fallback
  console.log('\n--- Testing Fallback Polling ---');
  const pollRes = await fetch('http://localhost:3000/api/messages?clientId=tab3_fallback');
  const pollData = await pollRes.json();
  console.log(`✓ Polling returned ${pollData.messages.length} messages, ${pollData.onlineCount} online.`);

  // Cleanup
  tab1.req.destroy();
  tab2.req.destroy();

  const success =
    tab2Received.some((m) => m.sender === 'Maya' && m.text === 'Hey Leo, welcome to Melody!') &&
    tab1Received.some((m) => m.sender === 'Leo' && m.text.includes('Thanks Maya!'));

  console.log('\n=======================================');
  if (success) {
    console.log('🎉 REAL-TIME TWO-TAB CHAT TEST PASSED!');
    process.exit(0);
  } else {
    console.error('❌ Test failed to exchange messages.');
    process.exit(1);
  }
}

runTwoTabChatTest();
