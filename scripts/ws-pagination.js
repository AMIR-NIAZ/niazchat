#!/usr/bin/env node
/**
 * Cursor-pagination checks for the WS `getMessages` event.
 *
 * Usage:
 *   TOKEN=<member access token> CHAT_ID=<chat with 150+ messages> \
 *     node scripts/ws-pagination.js
 *
 * Optional:
 *   SEED=1 TOKEN2=<second member token> SEED_COUNT=150
 *       Sends SEED_COUNT messages through the sockets (two users, no SQL),
 *       then soft-deletes every 10th seeded message to check gaps.
 *   NON_MEMBER_TOKEN=<token>   check a non-member cannot read any page
 *   BANNED_TOKEN=<token>       check a banned user cannot read any page
 *   URL=http://host:port       API origin (default http://localhost:3000)
 *
 * Exit code: 0 when every check passes, 1 otherwise.
 */

const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';
const TOKEN = process.env.TOKEN;
const TOKEN2 = process.env.TOKEN2;
const CHAT_ID = Number(process.env.CHAT_ID);
const NON_MEMBER_TOKEN = process.env.NON_MEMBER_TOKEN;
const BANNED_TOKEN = process.env.BANNED_TOKEN;
const SEED = process.env.SEED === '1';
const SEED_COUNT = Number(process.env.SEED_COUNT || 150);
const STEP_TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);
const LIMIT = 30;
const MIN_HISTORY = 150;

if (!TOKEN || !Number.isInteger(CHAT_ID) || CHAT_ID <= 0) {
  console.error(
    'Usage: TOKEN=<accessToken> CHAT_ID=<number> node scripts/ws-pagination.js',
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

/** Emit one request and resolve its ack `data`; reject on `{ ok: false }`. */
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

function getPage(socket, payload) {
  return request(socket, 'getMessages', { chatId: CHAT_ID, ...payload });
}

function isStrictlyDescending(ids) {
  return ids.every((id, index) => index === 0 || ids[index - 1] > id);
}

/** Walk every page at `limit` and return the collected ids. */
async function collectAll(socket, limit) {
  const ids = [];
  const pageSizes = [];
  let cursor;
  let pages = 0;

  for (;;) {
    const page = await getPage(
      socket,
      cursor === undefined ? { limit } : { limit, beforeId: cursor },
    );
    if (!page || !Array.isArray(page.messages)) {
      throw new Error('malformed getMessages ack (missing messages[])');
    }
    const pageIds = page.messages.map((message) => message.id);
    if (pageIds.some((id) => !Number.isInteger(id))) {
      throw new Error('non-numeric message id in page');
    }
    if (!isStrictlyDescending(pageIds)) {
      throw new Error('page ids are not strictly descending (newest first)');
    }
    ids.push(...pageIds);
    pageSizes.push(pageIds.length);
    pages += 1;

    if (page.hasMore === false) {
      return { ids, pageSizes, pages };
    }
    if (page.nextCursor === null) {
      throw new Error('hasMore=true but nextCursor is null');
    }
    if (!Number.isInteger(page.nextCursor)) {
      throw new Error('nextCursor is not a number');
    }
    if (page.nextCursor !== pageIds[pageIds.length - 1]) {
      throw new Error('nextCursor is not the oldest id of the page');
    }
    cursor = page.nextCursor;
    if (pages > 1000) {
      throw new Error('pagination did not terminate');
    }
  }
}

/** Send SEED_COUNT messages from two members, then soft-delete every 10th. */
async function seed(socketA, socketB) {
  const ids = [];
  const authorById = new Map();

  for (let index = 0; index < SEED_COUNT; index += 1) {
    const socket = index % 2 === 0 ? socketA : socketB;
    const sent = await request(socket, 'sendMessage', {
      chatId: CHAT_ID,
      content: `pagination-seed-${Date.now()}-${index}`,
      type: 'text',
    });
    const id = Number(sent && sent.id);
    if (!Number.isInteger(id)) {
      throw new Error(`sendMessage ack has no message id (index ${index})`);
    }
    ids.push(id);
    authorById.set(id, socket);
  }

  const deleted = new Set();
  for (let index = 9; index < ids.length; index += 10) {
    const id = ids[index];
    await request(authorById.get(id), 'deleteMessage', {
      chatId: CHAT_ID,
      messageId: id,
    });
    deleted.add(id);
  }

  return { ids, deleted };
}

async function expectReject(socket, name, payload) {
  try {
    await getPage(socket, payload);
    fail(name, 'request unexpectedly succeeded');
  } catch (error) {
    pass(`${name} rejected (${errorText(error)})`);
  }
}

async function main() {
  const socket = await connect(TOKEN);
  console.log(`connected to ${URL}`);

  try {
    await request(socket, 'joinChat', { chatId: CHAT_ID });
  } catch (error) {
    throw new Error(`joinChat failed: ${errorText(error)}`);
  }

  let seeded = null;
  if (SEED) {
    if (!TOKEN2) {
      throw new Error('SEED=1 requires TOKEN2 (second chat member)');
    }
    const second = await connect(TOKEN2);
    try {
      await request(second, 'joinChat', { chatId: CHAT_ID });
      seeded = await seed(socket, second);
      console.log(
        `seeded ${seeded.ids.length} messages (${seeded.deleted.size} soft-deleted)`,
      );
    } finally {
      second.close();
    }
  }

  // 6. Old clients: `{ chatId }` alone still returns the latest page.
  const legacyPage = await getPage(socket, {});
  if (
    !legacyPage ||
    !Array.isArray(legacyPage.messages) ||
    legacyPage.messages.length === 0
  ) {
    fail('latest page with { chatId } only', 'chat history is empty');
    return;
  }
  const explicitFirstPage = await getPage(socket, { limit: LIMIT });
  const legacyIds = legacyPage.messages.map((message) => message.id);
  const explicitIds = explicitFirstPage.messages.map((message) => message.id);
  if (JSON.stringify(legacyIds) === JSON.stringify(explicitIds)) {
    pass('latest page with { chatId } only matches { limit }');
  } else {
    fail('latest page with { chatId } only', 'differs from explicit limit page');
  }

  // 1. First page shape.
  const firstPageOk =
    explicitFirstPage.messages.length === LIMIT &&
    isStrictlyDescending(explicitIds) &&
    explicitFirstPage.hasMore === true &&
    explicitFirstPage.nextCursor === explicitIds[explicitIds.length - 1];
  if (firstPageOk) {
    pass(`first page: ${LIMIT} newest-first items, hasMore, nextCursor=oldest`);
  } else {
    fail(
      'first page shape',
      `len=${explicitFirstPage.messages.length} hasMore=${explicitFirstPage.hasMore} nextCursor=${explicitFirstPage.nextCursor}`,
    );
  }

  // 2. Walk every page: no duplicates, no gaps, strictly descending overall.
  let walk;
  try {
    walk = await collectAll(socket, LIMIT);
  } catch (error) {
    fail('walk all pages with beforeId', errorText(error));
    walk = null;
  }

  if (walk !== null) {
    const unique = new Set(walk.ids);
    if (unique.size === walk.ids.length) {
      pass(`no duplicate messages across ${walk.pages} pages`);
    } else {
      fail('no duplicate messages across pages', `${walk.ids.length - unique.size} duplicates`);
    }

    if (isStrictlyDescending(walk.ids)) {
      pass('ids strictly descending across page boundaries');
    } else {
      fail('ids strictly descending across page boundaries');
    }

    // Independent baseline: same walk at the max page size must yield the same set.
    try {
      const baseline = await collectAll(socket, 100);
      const sameSize = baseline.ids.length === walk.ids.length;
      const sameSet =
        sameSize && baseline.ids.every((id) => unique.has(id));
      if (sameSet) {
        pass(`pagination returns all ${walk.ids.length} messages exactly once`);
      } else {
        fail(
          'pagination returns all messages exactly once',
          `limit=${LIMIT} produced ${walk.ids.length}, limit=100 produced ${baseline.ids.length}`,
        );
      }
      if (walk.ids.length >= MIN_HISTORY) {
        pass(`chat has ${MIN_HISTORY}+ messages (${walk.ids.length})`);
      } else {
        fail(
          `chat has ${MIN_HISTORY}+ messages`,
          `found ${walk.ids.length} — seed it first (SEED=1)`,
        );
      }
    } catch (error) {
      fail('baseline walk at limit=100', errorText(error));
    }

    // 3. Soft-deleted messages never appear and leave no holes in the flow.
    if (seeded !== null) {
      const present = seeded.ids.filter((id) => unique.has(id));
      const deletedPresent = present.filter((id) => seeded.deleted.has(id));
      const missingLive = seeded.ids.filter(
        (id) => !seeded.deleted.has(id) && !unique.has(id),
      );
      if (deletedPresent.length === 0) {
        pass('soft-deleted messages never appear');
      } else {
        fail(
          'soft-deleted messages never appear',
          `${deletedPresent.length} deleted ids returned`,
        );
      }
      if (missingLive.length === 0) {
        pass('soft-deleted messages do not create gaps (all live seeds present)');
      } else {
        fail(
          'soft-deleted messages do not create gaps',
          `${missingLive.length} live seed ids missing`,
        );
      }
    } else {
      skip(
        'soft-deleted messages excluded',
        'run with SEED=1 to soft-delete seeded messages',
      );
    }
  }

  // 4. Validation: limit above max, limit 0 and non-numeric beforeId fail fast.
  await expectReject(socket, 'limit above max (100)', { limit: 500 });
  await expectReject(socket, 'limit = 0', { limit: 0 });
  await expectReject(socket, 'non-numeric beforeId', { beforeId: 'abc' });

  // 5. Non-member and banned users cannot read any page.
  if (!NON_MEMBER_TOKEN) {
    skip('non-member cannot read a page', 'set NON_MEMBER_TOKEN');
  } else {
    const outsider = await connect(NON_MEMBER_TOKEN);
    try {
      await expectReject(outsider, 'non-member cannot read a page', {});
    } finally {
      outsider.close();
    }
  }

  if (!BANNED_TOKEN) {
    skip('banned user cannot read a page', 'set BANNED_TOKEN');
  } else {
    const banned = await connect(BANNED_TOKEN);
    try {
      await expectReject(banned, 'banned user cannot read a page', {});
    } finally {
      banned.close();
    }
  }

  socket.close();
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
