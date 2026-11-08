#!/usr/bin/env node
/**
 * Typing-indicator + member-count checks (two users, group chat).
 *
 * Usage:
 *   TOKEN=<A> TOKEN2=<B> CHAT_ID=<group> node scripts/ws-typing.js
 *
 * Optional:
 *   PRIVATE_CHAT_ID=<chat where both are members>   group-only check
 *   NON_MEMBER_TOKEN=<token>                        not-joined check (or a second A socket)
 *   BANNED_TOKEN=<banned member token>              banned-member check
 *   ADD_MEMBER_PHONE=<phone>                         REST add-member → chat:members
 *   URL=http://host:port                             API origin
 *
 * Exit code: 0 when every check passes, 1 otherwise.
 */

const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';
const TOKEN = process.env.TOKEN;
const TOKEN2 = process.env.TOKEN2;
const CHAT_ID = Number(process.env.CHAT_ID);
const PRIVATE_CHAT_ID = Number(process.env.PRIVATE_CHAT_ID);
const NON_MEMBER_TOKEN = process.env.NON_MEMBER_TOKEN;
const BANNED_TOKEN = process.env.BANNED_TOKEN;
const ADD_MEMBER_PHONE = process.env.ADD_MEMBER_PHONE;
const STEP_TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);

if (!TOKEN || !TOKEN2 || !Number.isInteger(CHAT_ID) || CHAT_ID <= 0) {
    console.error(
        'Usage: TOKEN=<A> TOKEN2=<B> CHAT_ID=<group> node scripts/ws-typing.js',
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
                reject(
                    new Error(
                        response && response.message
                            ? String(response.message)
                            : `${event} failed`,
                    ),
                );
                return;
            }
            resolve(response.data);
        });
    });
}

function waitFor(socket, event, predicate, timeoutMs = 2000) {
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

function collect(socket, event, predicate, timeoutMs) {
    return new Promise((resolve) => {
        const events = [];
        const handler = (payload) => {
            if (predicate(payload)) events.push(payload);
        };
        socket.on(event, handler);
        setTimeout(() => {
            socket.off(event, handler);
            resolve(events);
        }, timeoutMs);
    });
}

async function profileName(token) {
    try {
        const response = await fetch(`${URL}/auth/getme`, {
            headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) return null;
        const json = await response.json();
        const user = json && json.data ? json.data : json;
        if (typeof user.name === 'string' && user.name !== '') return user.name;
        if (typeof user.username === 'string' && user.username !== '') {
            return user.username;
        }
        return '';
    } catch {
        return null;
    }
}

async function join(socket, chatId) {
    const info = await request(socket, 'joinChat', { chatId });
    return info;
}

async function main() {
    const a = await connect(TOKEN);
    const b = await connect(TOKEN2);
    console.log(`connected to ${URL}`);

    try {
        await join(a, CHAT_ID);
        const bInfo = await join(b, CHAT_ID);
        const memberCount = Number(bInfo.membersCount);
        if (Number.isInteger(memberCount) && memberCount > 0) {
            pass(`chatInfo.membersCount is a positive number (${memberCount})`);
        } else {
            fail(
                'chatInfo.membersCount',
                `got ${JSON.stringify(bInfo.membersCount)}`,
            );
        }

        const expectedName = await profileName(TOKEN);
        const startPromise = waitFor(
            b,
            'typing:start',
            (payload) =>
                Number(payload.chatId) === CHAT_ID &&
                Number(payload.userId) !== undefined,
        );
        const ownEvents = collect(
            a,
            'typing:start',
            (payload) => Number(payload.chatId) === CHAT_ID,
            500,
        );
        a.emit('userTyping', { chatId: CHAT_ID }, () => {});
        const startEvent = await startPromise;
        const own = await ownEvents;

        if (startEvent) {
            const checks = [
                Number.isInteger(Number(startEvent.userId)),
                typeof startEvent.userName === 'string',
                expectedName === null || startEvent.userName === expectedName,
            ];
            if (checks.every(Boolean)) {
                pass(
                    `B receives typing:start with userId and userName "${startEvent.userName}"`,
                );
            } else {
                fail('typing:start payload', JSON.stringify(startEvent));
            }
        } else {
            fail('typing:start broadcast', 'no event received');
        }
        if (own.length === 0) {
            pass('sender does not receive its own typing:start');
        } else {
            fail('sender does not receive its own typing:start');
        }

        const stopPromise = waitFor(
            b,
            'typing:stop',
            (payload) =>
                Number(payload.chatId) === CHAT_ID &&
                Number(payload.userId) === Number(startEvent?.userId),
        );
        a.emit('userEndTyping', { chatId: CHAT_ID }, () => {});
        const stopEvent = await stopPromise;
        if (stopEvent && typeof stopEvent.userName === 'string') {
            pass('B receives typing:stop with userName');
        } else {
            fail('typing:stop broadcast', 'missing or malformed');
        }

        // Rate limit: wait out the previous start, then two starts <1 s apart.
        await sleep(1100);
        const rateEvents = collect(
            b,
            'typing:start',
            (payload) => Number(payload.chatId) === CHAT_ID,
            900,
        );
        a.emit('userTyping', { chatId: CHAT_ID }, () => {});
        await sleep(100);
        a.emit('userTyping', { chatId: CHAT_ID }, () => {});
        const limited = await rateEvents;
        if (limited.length === 1) {
            pass('two starts within 1 s produce one broadcast');
        } else {
            fail('typing start rate limit', `${limited.length} broadcasts`);
        }

        const stopAfterLimit = waitFor(
            b,
            'typing:stop',
            (payload) => Number(payload.chatId) === CHAT_ID,
        );
        a.emit('userEndTyping', { chatId: CHAT_ID }, () => {});
        if (await stopAfterLimit) {
            pass('typing:stop is always delivered');
        } else {
            fail('typing:stop after rate limit', 'not delivered');
        }

        // A second A socket that has NOT joined the room must not broadcast.
        const notJoined =
            NON_MEMBER_TOKEN !== undefined
                ? await connect(NON_MEMBER_TOKEN)
                : await connect(TOKEN);
        const noRoomEvents = collect(
            b,
            'typing:start',
            (payload) => Number(payload.chatId) === CHAT_ID,
            700,
        );
        notJoined.emit('userTyping', { chatId: CHAT_ID }, () => {});
        if ((await noRoomEvents).length === 0) {
            pass('typing from a socket/chat that was not joined is ignored');
        } else {
            fail('not-joined typing', 'event was broadcast');
        }
        notJoined.close();

        if (!BANNED_TOKEN) {
            skip('banned member typing is ignored', 'set BANNED_TOKEN');
        } else {
            const banned = await connect(BANNED_TOKEN);
            try {
                const bannedEvents = collect(
                    b,
                    'typing:start',
                    (payload) => Number(payload.chatId) === CHAT_ID,
                    700,
                );
                banned.emit('userTyping', { chatId: CHAT_ID }, () => {});
                if ((await bannedEvents).length === 0) {
                    pass('banned member typing is ignored');
                } else {
                    fail('banned member typing', 'event was broadcast');
                }
            } finally {
                banned.close();
            }
        }

        if (
            !Number.isInteger(PRIVATE_CHAT_ID) ||
            PRIVATE_CHAT_ID <= 0
        ) {
            skip('private chat typing is not broadcast', 'set PRIVATE_CHAT_ID');
        } else {
            try {
                await join(a, PRIVATE_CHAT_ID);
                await join(b, PRIVATE_CHAT_ID);
                const privateEvents = collect(
                    b,
                    'typing:start',
                    (payload) =>
                        Number(payload.chatId) === PRIVATE_CHAT_ID,
                    700,
                );
                a.emit('userTyping', { chatId: PRIVATE_CHAT_ID }, () => {});
                if ((await privateEvents).length === 0) {
                    pass('private chat typing is not broadcast');
                } else {
                    fail('private chat typing', 'event was broadcast');
                }
                const groupAgain = await join(b, CHAT_ID);
                await join(a, CHAT_ID);
                if (Number(groupAgain.membersCount) === memberCount) {
                    pass('member count is stable across re-join');
                }
            } catch (error) {
                fail('private chat typing check', errorText(error));
            }
        }

        if (!ADD_MEMBER_PHONE) {
            skip(
                'adding a member emits chat:members',
                'set ADD_MEMBER_PHONE',
            );
        } else {
            const before = await join(a, CHAT_ID);
            const beforeCount = Number(before.membersCount);
            const membersEvent = waitFor(
                b,
                'chat:members',
                (payload) => Number(payload.chatId) === CHAT_ID,
                5000,
            );
            const response = await fetch(
                `${URL}/chats/manage/${CHAT_ID}/add/${encodeURIComponent(
                    ADD_MEMBER_PHONE,
                )}`,
                {
                    method: 'POST',
                    headers: { authorization: `Bearer ${TOKEN}` },
                },
            );
            const event = await membersEvent;
            if (!response.ok) {
                fail(
                    'adding a member via REST',
                    `HTTP ${response.status}: ${await response.text()}`,
                );
            } else if (
                event &&
                Number(event.membersCount) === beforeCount + 1
            ) {
                pass('adding a member emits chat:members with the new count');
            } else {
                fail(
                    'chat:members after add',
                    `before=${beforeCount} event=${JSON.stringify(event)}`,
                );
            }
        }

        // Disconnect while typing (done last: it closes A's socket).
        await sleep(1100);
        const disconnectStop = waitFor(
            b,
            'typing:stop',
            (payload) => Number(payload.chatId) === CHAT_ID,
            3000,
        );
        a.emit('userTyping', { chatId: CHAT_ID }, () => {});
        await sleep(150);
        a.close();
        if (await disconnectStop) {
            pass('disconnect while typing emits typing:stop');
        } else {
            fail('disconnect typing stop', 'no typing:stop received');
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
