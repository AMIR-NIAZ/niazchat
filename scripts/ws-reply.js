#!/usr/bin/env node
/**
 * Reply-to-message checks over the WS surface (two users, same chat).
 *
 * Usage:
 *   TOKEN=<user A token> TOKEN2=<user B token> CHAT_ID=<chat both belong to> \
 *     node scripts/ws-reply.js
 *
 * Optional:
 *   CHAT_ID_OTHER=<another chat A belongs to>   cross-chat reply rejection
 *   URL=http://host:port                        API origin (default localhost:3000)
 *
 * This script creates a few messages/replies/deletions in the given chat.
 * Exit code: 0 when every check passes or is skipped, 1 otherwise.
 */

const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';
const TOKEN = process.env.TOKEN;
const TOKEN2 = process.env.TOKEN2;
const CHAT_ID = Number(process.env.CHAT_ID);
const CHAT_ID_OTHER = Number(process.env.CHAT_ID_OTHER || 0);
const STEP_TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);
const PAGE_SIZE = 30;
const MAX_PREVIEW = 201; // 200 chars + the ellipsis
const LONG_TEXT = 'x'.repeat(450);

if (!TOKEN || !TOKEN2 || !Number.isInteger(CHAT_ID) || CHAT_ID <= 0) {
  console.error(
    'Usage: TOKEN=<a> TOKEN2=<b> CHAT_ID=<number> node scripts/ws-reply.js',
  );
  process.exit(1);
}

let failures = 0;

function pass(name) {
  console.log(`PASS  ${name}`);
}

function fail(name, detail) {
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(name, reason) {
  console.log(`SKIP  ${name} — ${reason}`);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function connect(token) {
  const socket = io(URL, {
    extraHeaders: { authorization: `Bearer ${token}` },
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('connect timeout'));
    }, STEP_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(error.message));
    });
  });
}

function request(socket, event, payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timeout waiting for "${event}" ack`));
    }, STEP_TIMEOUT_MS);
    socket.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!response || response.ok !== true) {
        const message =
          response && response.message !== undefined
            ? typeof response.message === 'string'
              ? response.message
              : JSON.stringify(response.message)
            : `${event} failed`;
        reject(new Error(message));
        return;
      }
      resolve(response.data);
    });
  });
}

function waitForEvent(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for "${event}"`));
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

async function expectReject(socket, name, payload) {
  try {
    await request(socket, 'sendMessage', payload);
    fail(name, 'send unexpectedly succeeded');
  } catch (error) {
    pass(`${name} rejected (${errorText(error)})`);
  }
}

function checkPreview(name, preview, expected) {
  if (preview === null || preview === undefined) {
    fail(name, 'missing replyTo');
    return;
  }
  const problems = [];
  if (preview.id !== expected.id) problems.push(`id=${preview.id}`);
  if (preview.senderName !== expected.senderName) {
    problems.push(`senderName=${JSON.stringify(preview.senderName)}`);
  }
  if (typeof preview.content !== 'string') {
    problems.push('content is not a string');
  } else if (
    expected.contentPrefix &&
    !preview.content.startsWith(expected.contentPrefix)
  ) {
    problems.push('content mismatch');
  }
  if (preview.isDeleted !== false) problems.push('isDeleted should be false');
  if (problems.length === 0) {
    pass(name);
  } else {
    fail(name, problems.join(', '));
  }
}

async function latestPage(socket) {
  return request(socket, 'getMessages', { chatId: CHAT_ID, limit: PAGE_SIZE });
}

/** Walk every page at `limit`; returns all messages in newest-first order. */
async function fetchHistory(socket) {
  const messages = [];
  let cursor;
  let pages = 0;
  for (;;) {
    const page = await request(
      socket,
      'getMessages',
      cursor === undefined
        ? { chatId: CHAT_ID, limit: PAGE_SIZE }
        : { chatId: CHAT_ID, limit: PAGE_SIZE, beforeId: cursor },
    );
    if (!page || !Array.isArray(page.messages)) {
      throw new Error('malformed getMessages ack (missing messages[])');
    }
    messages.push(...page.messages);
    pages += 1;
    if (page.hasMore === false) {
      return { messages, pages };
    }
    if (page.nextCursor === null) {
      throw new Error('hasMore=true but nextCursor=null');
    }
    cursor = page.nextCursor;
    if (pages > 1000) throw new Error('pagination did not terminate');
  }
}

async function main() {
  const a = await connect(TOKEN);
  const b = await connect(TOKEN2);
  try {
    await request(a, 'joinChat', { chatId: CHAT_ID });
    await request(b, 'joinChat', { chatId: CHAT_ID });

    const stamp = Date.now();

    // 1. A sends M; B replies; the ack and both live echoes carry the preview.
    const m = await request(a, 'sendMessage', {
      chatId: CHAT_ID,
      content: `reply-target-${stamp}`,
      type: 'text',
    });

    if (m && m.replyTo === null && m.replyToId === null) {
      pass('a plain message has replyTo=null');
    } else {
      fail('a plain message has replyTo=null', JSON.stringify(m && m.replyTo));
    }

    const aEcho = waitForEvent(
      a,
      'sendMessage:list',
      (message) => message && message.replyToId === m.id,
    );
    const bEcho = waitForEvent(
      b,
      'sendMessage:list',
      (message) => message && message.replyToId === m.id,
    );
    const replyContent = `reply-${stamp}`;
    const replyAck = await request(b, 'sendMessage', {
      chatId: CHAT_ID,
      content: replyContent,
      reply: m.id,
      type: 'text',
    });

    checkPreview('reply ack carries replyTo', replyAck.replyTo, {
      id: m.id,
      senderName: m.sender?.name ?? '',
      contentPrefix: `reply-target-${stamp}`,
    });
    if (replyAck.replyToId === m.id) {
      pass('reply ack keeps replyToId');
    } else {
      fail('reply ack keeps replyToId', String(replyAck.replyToId));
    }

    try {
      const [echoA, echoB] = await Promise.all([aEcho, bEcho]);
      checkPreview('sender echo carries replyTo', echoA.replyTo, {
        id: m.id,
        senderName: m.sender?.name ?? '',
      });
      checkPreview('peer echo carries replyTo', echoB.replyTo, {
        id: m.id,
        senderName: m.sender?.name ?? '',
      });
    } catch (error) {
      fail('live sendMessage:list echoes', errorText(error));
    }

    // 5. A very long original is truncated in the preview.
    const long = await request(a, 'sendMessage', {
      chatId: CHAT_ID,
      content: `${LONG_TEXT}-${stamp}`,
      type: 'text',
    });
    const longReply = await request(b, 'sendMessage', {
      chatId: CHAT_ID,
      content: `long-reply-${stamp}`,
      reply: long.id,
      type: 'text',
    });
    if (
      typeof longReply.replyTo?.content === 'string' &&
      longReply.replyTo.content.length <= MAX_PREVIEW
    ) {
      pass(
        `long original truncated (${longReply.replyTo.content.length} chars)`,
      );
    } else {
      fail(
        'long original truncated',
        `content length ${longReply.replyTo?.content?.length}`,
      );
    }

    // 4. Editing the original updates the preview; editing the reply keeps replyTo.
    const editedContent = `reply-target-edited-${stamp}`;
    await request(a, 'editMessage', {
      chatId: CHAT_ID,
      messageId: m.id,
      newContent: editedContent,
    });
    const afterEdit = await latestPage(b);
    const replyAfterEdit = afterEdit.messages.find(
      (message) => message.id === replyAck.id,
    );
    if (replyAfterEdit?.replyTo?.content === editedContent) {
      pass('history reflects the edited original in replyTo.content');
    } else {
      fail(
        'history reflects the edited original',
        JSON.stringify(replyAfterEdit?.replyTo),
      );
    }

    const editedReply = await request(b, 'editMessage', {
      chatId: CHAT_ID,
      messageId: replyAck.id,
      newContent: `${replyContent}-edited`,
    });
    if (editedReply.replyToId === m.id && editedReply.replyTo?.id === m.id) {
      pass('editing a reply keeps its replyTo');
    } else {
      fail('editing a reply keeps its replyTo', JSON.stringify(editedReply));
    }

    // 2. Invalid replies fail fast.
    await expectReject(b, 'reply to a nonexistent message', {
      chatId: CHAT_ID,
      content: 'nope',
      reply: 999999999,
      type: 'text',
    });

    if (Number.isInteger(CHAT_ID_OTHER) && CHAT_ID_OTHER > 0) {
      let otherChatMessageId = null;
      try {
        const otherMessage = await request(a, 'sendMessage', {
          chatId: CHAT_ID_OTHER,
          content: `other-chat-${stamp}`,
          type: 'text',
        });
        otherChatMessageId = otherMessage.id;
      } catch (error) {
        skip(
          'reply to a message from another chat',
          `cannot post to CHAT_ID_OTHER: ${errorText(error)}`,
        );
      }
      if (otherChatMessageId !== null) {
        await expectReject(b, 'reply to a message from another chat', {
          chatId: CHAT_ID,
          content: 'cross-chat',
          reply: otherChatMessageId,
          type: 'text',
        });
      }
    } else {
      skip('reply to a message from another chat', 'set CHAT_ID_OTHER');
    }

    const deletedOriginal = await request(a, 'sendMessage', {
      chatId: CHAT_ID,
      content: `deleted-target-${stamp}`,
      type: 'text',
    });
    await request(a, 'deleteMessage', {
      chatId: CHAT_ID,
      messageId: deletedOriginal.id,
    });
    await expectReject(b, 'reply to a deleted message', {
      chatId: CHAT_ID,
      content: 'deleted',
      reply: deletedOriginal.id,
      type: 'text',
    });

    // 3. Deleting M keeps its reply with a deleted preview; M leaves history;
    //    every page still carries replyTo and pagination has no dupes/gaps.
    await request(a, 'deleteMessage', { chatId: CHAT_ID, messageId: m.id });

    let history;
    try {
      history = await fetchHistory(b);
    } catch (error) {
      fail('paginated history walk', errorText(error));
      history = null;
    }

    if (history !== null) {
      const ids = history.messages.map((message) => message.id);
      const unique = new Set(ids);
      if (unique.size === ids.length) {
        pass(`pagination has no duplicates across ${history.pages} pages`);
      } else {
        fail(
          'pagination has no duplicates',
          `${ids.length - unique.size} duplicates`,
        );
      }
      const descending = ids.every(
        (id, index) => index === 0 || ids[index - 1] > id,
      );
      if (descending) {
        pass('pagination ids strictly descending across page boundaries');
      } else {
        fail('pagination ids strictly descending across page boundaries');
      }

      const replyInHistory = history.messages.find(
        (message) => message.id === replyAck.id,
      );
      if (replyInHistory === undefined) {
        fail('reply still returned after original deletion');
      } else if (
        replyInHistory.replyTo?.isDeleted === true &&
        replyInHistory.replyTo.content === null
      ) {
        pass(
          'reply still returned after original deletion with deleted preview',
        );
      } else {
        fail(
          'reply deleted preview',
          JSON.stringify(replyInHistory.replyTo),
        );
      }

      if (history.messages.some((message) => message.id === m.id)) {
        fail('deleted original is not in history');
      } else {
        pass('deleted original is not in history');
      }

      const missingPreview = history.messages.filter(
        (message) =>
          message.replyToId !== null && message.replyTo === null,
      );
      if (missingPreview.length === 0) {
        pass('every reply on every page carries replyTo');
      } else {
        fail(
          'every reply on every page carries replyTo',
          `${missingPreview.length} replies without preview`,
        );
      }
    }
  } finally {
    a.close();
    b.close();
  }
}

main()
  .then(() => {
    if (failures > 0) {
      console.log(`\n${failures} check(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log('\nALL CHECKS PASSED');
    }
  })
  .catch((error) => {
    console.error(`\nFAILED: ${errorText(error)}`);
    process.exitCode = 1;
  });
