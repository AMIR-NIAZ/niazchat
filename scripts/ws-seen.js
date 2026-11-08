#!/usr/bin/env node
/**
 * Two-user checks for read receipts + unread counts.
 *
 * Usage:
 *   TOKEN=<A token> TOKEN2=<B token> CHAT_ID=<shared chat> \
 *     node scripts/ws-seen.js
 *
 * Optional:
 *   TOKEN3=<B's second device token>   verify `chat:read` clears other devices
 *   CHAT_ID_OTHER=<another chat A or B belongs to>  cross-chat rejection
 *   EMPTY_CHAT_ID=<chat B belongs to with no messages> empty-chat checks
 *   NON_MEMBER_TOKEN / BANNED_TOKEN    guard checks
 *   COUNT=120                          messages for the cap check
 *   URL=http://host:port               API origin (default http://localhost:3000)
 *
 * Exit code: 0 when every check passes, 1 otherwise.
 */

const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';
const TOKEN = process.env.TOKEN;
const TOKEN2 = process.env.TOKEN2;
const TOKEN3 = process.env.TOKEN3;
const CHAT_ID = Number(process.env.CHAT_ID);
const CHAT_ID_OTHER = Number(process.env.CHAT_ID_OTHER);
const EMPTY_CHAT_ID = Number(process.env.EMPTY_CHAT_ID);
const NON_MEMBER_TOKEN = process.env.NON_MEMBER_TOKEN;
const BANNED_TOKEN = process.env.BANNED_TOKEN;
const COUNT = Number(process.env.COUNT || 120);
const STEP_TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);
const UNREAD_CAP = 100;

if (!TOKEN || !TOKEN2 || !Number.isInteger(CHAT_ID) || CHAT_ID <= 0) {
    console.error(
        'Usage: TOKEN=<A> TOKEN2=<B> CHAT_ID=<number> node scripts/ws-seen.js',
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

async function expectReject(socket, name, payload) {
    try {
        await request(socket, 'markSeen', payload);
        fail(name, 'request unexpectedly succeeded');
    } catch (error) {
        pass(`${name} rejected (${errorText(error)})`);
    }
}

function waitFor(socket, event, predicate, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            resolve(null);
        }, timeoutMs);
        const handler = (payload) => {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        };
        socket.on(event, handler);
    });
}

async function unreadFor(socket, chatId) {
    const chats = await request(socket, 'getAllChats');
    const row = (chats || []).find((chat) => Number(chat.id) === chatId);
    return row ? Number(row.unreadCount) : Number.NaN;
}

async function latestMessageId(socket, chatId) {
    const page = await request(socket, 'getMessages', { chatId, limit: 1 });
    const message = page && page.messages ? page.messages[0] : null;
    return message ? Number(message.id) : null;
}

async function send(socket, content) {
    const message = await request(socket, 'sendMessage', {
        chatId: CHAT_ID,
        content,
        type: 'text',
    });
    const id = Number(message && message.id);
    if (!Number.isInteger(id)) {
        throw new Error('sendMessage ack has no message id');
    }
    return id;
}

async function main() {
    const a = await connect(TOKEN);
    const b = await connect(TOKEN2);
    const b2 = TOKEN3 ? await connect(TOKEN3) : null;
    console.log(`connected to ${URL}`);

    try {
        await request(a, 'joinChat', { chatId: CHAT_ID });

        // Baseline: B has read everything that exists before the test.
        const baselineId = await latestMessageId(b, CHAT_ID);
        if (baselineId !== null) {
            await request(b, 'markSeen', {
                chatId: CHAT_ID,
                lastSeenId: baselineId,
            });
        }
        if ((await unreadFor(b, CHAT_ID)) === 0) {
            pass('baseline: B has zero unread');
        } else {
            fail('baseline: B has zero unread', 'markSeen did not clear it');
        }

        // 1. A sends 3 while B is not in the room.
        const firstId = await send(a, `seen-check-${Date.now()}-1`);
        await send(a, `seen-check-${Date.now()}-2`);
        const lastId = await send(a, `seen-check-${Date.now()}-3`);

        const bUnread = await unreadFor(b, CHAT_ID);
        if (bUnread === 3) {
            pass('B (not in the room) sees unreadCount = 3');
        } else {
            fail('B unreadCount = 3', `got ${bUnread}`);
        }
        const aUnread = await unreadFor(a, CHAT_ID);
        if (aUnread === 0) {
            pass("A's own messages do not count as unread");
        } else {
            fail("A's own unreadCount = 0", `got ${aUnread}`);
        }

        // A reads its own messages: this is B's `othersLastSeenId`.
        await request(a, 'markSeen', { chatId: CHAT_ID, lastSeenId: lastId });

        // 2. Joining must not mark read nor emit `seen`.
        let joined = null;
        let sawSeenOnJoin = false;
        const joinSeenHandler = (payload) => {
            if (
                Number(payload.chatId) === CHAT_ID &&
                Number(payload.lastSeenId) === baselineId
            ) {
                sawSeenOnJoin = true;
            }
        };
        a.on('seen', joinSeenHandler);
        joined = await request(b, 'joinChat', { chatId: CHAT_ID });
        await sleep(700);
        a.off('seen', joinSeenHandler);

        if (joined.myLastSeenId === baselineId) {
            pass(
                `chatInfo.myLastSeenId is the pre-join value (${String(
                    baselineId,
                )})`,
            );
        } else {
            fail(
                'chatInfo.myLastSeenId',
                `expected ${String(baselineId)}, got ${String(
                    joined.myLastSeenId,
                )}`,
            );
        }
        if (joined.othersLastSeenId === lastId) {
            pass('chatInfo.othersLastSeenId is A\'s position');
        } else {
            fail(
                'chatInfo.othersLastSeenId',
                `expected ${lastId}, got ${String(joined.othersLastSeenId)}`,
            );
        }
        if (sawSeenOnJoin) {
            fail('joining emits no seen', 'a `seen` was broadcast on join');
        } else {
            pass('joining emits no seen');
        }
        if ((await unreadFor(b, CHAT_ID)) === 3) {
            pass('joining alone does not change B\'s unread count');
        } else {
            fail('joining keeps unreadCount = 3', 'count changed on join');
        }

        // 3. B reads the latest message.
        const seenPromise = waitFor(
            a,
            'seen',
            (payload) =>
                Number(payload.chatId) === CHAT_ID &&
                Number(payload.lastSeenId) === lastId,
            2000,
        );
        const readPromise = b2
            ? waitFor(
                  b2,
                  'chat:read',
                  (payload) => Number(payload.chatId) === CHAT_ID,
                  2000,
              )
            : Promise.resolve(null);
        const ack = await request(b, 'markSeen', {
            chatId: CHAT_ID,
            lastSeenId: lastId,
        });
        const seenEvent = await seenPromise;
        const readEvent = await readPromise;

        if (ack && Number(ack.lastSeenId) === lastId) {
            pass('markSeen acks the effective lastSeenId');
        } else {
            fail('markSeen ack', `got ${JSON.stringify(ack)}`);
        }
        if (seenEvent && Number(seenEvent.lastSeenId) === lastId) {
            pass('A receives `seen` with B\'s position');
        } else {
            fail('A receives `seen`', 'no matching event');
        }
        if (b2 === null) {
            skip('other device receives chat:read', 'set TOKEN3');
        } else if (readEvent && Number(readEvent.unreadCount) === 0) {
            pass('B\'s other device receives chat:read');
        } else {
            fail('B\'s other device receives chat:read', 'no matching event');
        }
        if ((await unreadFor(b, CHAT_ID)) === 0) {
            pass('B\'s unread count is 0 after reading');
        } else {
            fail('B\'s unread count is 0', 'still non-zero');
        }

        // 4. Monotonicity, cross-chat ids and clamping.
        const spy = [];
        const spyHandler = (payload) => spy.push(payload);
        a.on('seen', spyHandler);
        const noopAck = await request(b, 'markSeen', {
            chatId: CHAT_ID,
            lastSeenId: firstId,
        });
        await sleep(700);
        a.off('seen', spyHandler);
        if (Number(noopAck.lastSeenId) === lastId && spy.length === 0) {
            pass('lower id is a no-op (acks current value, emits nothing)');
        } else {
            fail(
                'lower id no-op',
                `ack=${JSON.stringify(noopAck)} events=${spy.length}`,
            );
        }

        if (!Number.isInteger(CHAT_ID_OTHER) || CHAT_ID_OTHER <= 0) {
            skip('cross-chat message id is rejected', 'set CHAT_ID_OTHER');
        } else {
            try {
                const otherPage = await request(a, 'getMessages', {
                    chatId: CHAT_ID_OTHER,
                    limit: 100,
                });
                const otherIds = (otherPage.messages || []).map((message) =>
                    Number(message.id),
                );
                const otherId = otherIds.length
                    ? Math.min(...otherIds)
                    : null;
                if (otherId === null) {
                    skip(
                        'cross-chat message id is rejected',
                        'other chat has no messages',
                    );
                } else if (otherId > lastId) {
                    skip(
                        'cross-chat message id is rejected',
                        'other id is above this chat\'s newest (would be clamped)',
                    );
                } else {
                    await expectReject(
                        b,
                        'cross-chat message id is rejected',
                        { chatId: CHAT_ID, lastSeenId: otherId },
                    );
                }
            } catch (error) {
                skip(
                    'cross-chat message id is rejected',
                    `cannot read CHAT_ID_OTHER: ${errorText(error)}`,
                );
            }
        }

        const clamped = await request(b, 'markSeen', {
            chatId: CHAT_ID,
            lastSeenId: lastId + 1000,
        });
        if (Number(clamped.lastSeenId) === lastId) {
            pass('id above the newest message is clamped');
        } else {
            fail(
                'id above the newest message is clamped',
                `got ${String(clamped.lastSeenId)}`,
            );
        }

        // 5. A deleted unread message does not count.
        const deletedId = await send(a, `seen-deleted-${Date.now()}`);
        await request(a, 'deleteMessage', {
            chatId: CHAT_ID,
            messageId: deletedId,
        });
        if ((await unreadFor(b, CHAT_ID)) === 0) {
            pass('a deleted unread message is not counted');
        } else {
            fail('a deleted unread message is not counted', 'count > 0');
        }

        if (!Number.isInteger(EMPTY_CHAT_ID) || EMPTY_CHAT_ID <= 0) {
            skip('empty chat works', 'set EMPTY_CHAT_ID');
        } else {
            try {
                const emptyInfo = await request(b, 'joinChat', {
                    chatId: EMPTY_CHAT_ID,
                });
                const emptyAck = await request(b, 'markSeen', {
                    chatId: EMPTY_CHAT_ID,
                    lastSeenId: 1,
                });
                if (
                    emptyInfo.myLastSeenId === null &&
                    emptyAck.lastSeenId === 0 &&
                    (await unreadFor(b, EMPTY_CHAT_ID)) === 0
                ) {
                    pass('empty chat: join, markSeen and unread count work');
                } else {
                    fail('empty chat checks', JSON.stringify(emptyAck));
                }
                await request(b, 'joinChat', { chatId: CHAT_ID });
            } catch (error) {
                fail('empty chat checks', errorText(error));
            }
        }

        // 6. Guards.
        if (!NON_MEMBER_TOKEN) {
            skip('non-member cannot markSeen', 'set NON_MEMBER_TOKEN');
        } else {
            const outsider = await connect(NON_MEMBER_TOKEN);
            try {
                await expectReject(outsider, 'non-member cannot markSeen', {
                    chatId: CHAT_ID,
                    lastSeenId: lastId,
                });
            } finally {
                outsider.close();
            }
        }
        if (!BANNED_TOKEN) {
            skip('banned user cannot markSeen', 'set BANNED_TOKEN');
        } else {
            const banned = await connect(BANNED_TOKEN);
            try {
                await expectReject(banned, 'banned user cannot markSeen', {
                    chatId: CHAT_ID,
                    lastSeenId: lastId,
                });
            } finally {
                banned.close();
            }
        }

        // 7. Large unread count, capped, with one authoritative query.
        const started = Date.now();
        for (let index = 0; index < COUNT; index += 10) {
            await Promise.all(
                Array.from({ length: Math.min(10, COUNT - index) }, (_, k) =>
                    send(a, `seen-cap-${started}-${index + k}`),
                ),
            );
        }
        const listStarted = Date.now();
        const cappedUnread = await unreadFor(b, CHAT_ID);
        const listMs = Date.now() - listStarted;
        const expectedCap = Math.min(COUNT, UNREAD_CAP);
        if (cappedUnread === expectedCap) {
            pass(
                `${COUNT} messages show unreadCount = ${cappedUnread} (capped at ${UNREAD_CAP})`,
            );
        } else {
            fail(
                `${COUNT} messages unreadCount`,
                `expected ${expectedCap}, got ${cappedUnread}`,
            );
        }
        console.log(
            `INFO  getAllChats (whole list, unread counts) took ${listMs} ms`,
        );
    } finally {
        a.close();
        b.close();
        if (b2 !== null) b2.close();
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
