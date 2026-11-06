// Usage:
//   npm i socket.io-client
//   TOKEN=<accessToken> CHAT_ID=2 node test-send-message.js
//   TOKEN=... CHAT_ID=2 TEXT="hello from script" COUNT=3 node test-send-message.js
//   TOKEN=... CHAT_ID=2 URL=http://192.168.100.10:3000 node test-send-message.js
//
// Flow (same as the app):
//   1. joinChat (bare number)      -> wait for `chatInfo`
//   2. getMessages ({ chatId })    -> wait for `getMessages` event (history)
//   3. sendMessage ({ chatId, content }) -> wait for the `sendMessage:list` echo
//
// Note: the ack of joinChat / getMessages / sendMessage is called ONLY on errors
// (Nest never acks a handler that returns undefined). Success is signalled by events.

const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://192.168.100.10:3000';
const TOKEN = process.env.TOKEN;
const CHAT_ID = Number(process.env.CHAT_ID);
const TEXT = process.env.TEXT || 'test message from script';
const COUNT = Number(process.env.COUNT || 1);
const STEP_TIMEOUT_MS = 10_000;

if (!TOKEN || !Number.isInteger(CHAT_ID)) {
  console.error('Usage: TOKEN=<accessToken> CHAT_ID=<number> node test-send-message.js');
  process.exit(1);
}

const socket = io(URL, {
  extraHeaders: { authorization: `Bearer ${TOKEN}` },
  auth: { token: TOKEN },
  transports: ['websocket'],
});

function fail(msg) {
  console.error(`\nFAILED: ${msg}`);
  socket.close();
  process.exit(2);
}

/** Wait for a server event (optionally filtered), with a timeout. */
function waitForEvent(event, label, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for "${event}" (${label})`));
    }, STEP_TIMEOUT_MS);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Emit with an ack that is only ever called on errors. */
function emitErrorAck(event, payload, onError) {
  socket.emit(event, payload, (err) => {
    if (err !== undefined && err !== null) onError(err);
  });
}

// Errors from guards/pipes often arrive as a separate `exception` event
socket.on('exception', (err) => {
  console.error('[server exception]:', err);
});
socket.on('connect_error', (err) => console.error('connect_error:', err.message));

socket.on('connect', async () => {
  console.log(`connected. id=${socket.id}`);

  try {
    // 1. joinChat -> chatInfo
    const infoPromise = waitForEvent('chatInfo', 'joinChat');
    emitErrorAck('joinChat', CHAT_ID, (err) => {
      console.error('[joinChat ack error]:', err);
    });
    const info = await infoPromise;
    console.log(`joined chat ${CHAT_ID}: title=${JSON.stringify(info.title)} type=${info.type}`);

    // 2. getMessages -> getMessages event (payload MUST be an object)
    const historyPromise = waitForEvent('getMessages', 'history');
    emitErrorAck('getMessages', { chatId: CHAT_ID }, (err) => {
      console.error('[getMessages ack error]:', err);
    });
    const history = await historyPromise;
    console.log(`history: ${history.length} messages (newest first)`);

    // 3. sendMessage -> echo on `sendMessage:list`
    for (let i = 1; i <= COUNT; i++) {
      const content = COUNT > 1 ? `${TEXT} #${i}` : TEXT;
      const started = Date.now();

      const echoPromise = waitForEvent(
        'sendMessage:list',
        'echo',
        (m) => m && m.content === content,
      );
      emitErrorAck('sendMessage', { chatId: CHAT_ID, content }, (err) => {
        console.error('[sendMessage ack error]:', err);
      });

      const echo = await echoPromise;
      console.log(
        `sent "${content}" -> echo received in ${Date.now() - started}ms (message id=${echo.id})`,
      );
    }

    console.log('\nOK: join, history and send all work.');
    socket.close();
    process.exit(0);
  } catch (e) {
    fail(e.message);
  }
});