#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * End-to-end reactions check (HTTP health + Socket.IO).
 *
 * Required env:
 *   URL             API origin
 *   TOKEN_A         chat member A (sends/edits/deletes/forwards)
 *   TOKEN_B         chat member B (reacts/switches)
 *   TOKEN_OUTSIDER  authenticated non-member
 *   CHAT_ID         group chat both A and B belong to
 *
 * Optional:
 *   TOKEN_BANNED        chat member with the `ban` role
 *   CHAT_ID_OTHER       another chat both A and B belong to (cross-chat test)
 *   RATE_LIMIT_WAIT_MS  recovery wait after the 61st reaction (default 61000)
 *
 * Usage:
 *   URL=http://localhost:3000 TOKEN_A=... TOKEN_B=... \
 *     TOKEN_OUTSIDER=... CHAT_ID=35 node scripts/reactions.js
 *
 * Exit 0 when every check passes, 1 on failure, 2 on missing configuration.
 */

const { io } = require('socket.io-client');

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A ?? '';
const TOKEN_B = process.env.TOKEN_B ?? '';
const TOKEN_OUTSIDER = process.env.TOKEN_OUTSIDER ?? '';
const TOKEN_BANNED = process.env.TOKEN_BANNED ?? '';
const CHAT_ID = Number(process.env.CHAT_ID);
const CHAT_ID_OTHER = Number(process.env.CHAT_ID_OTHER ?? 0);
const RATE_LIMIT_WAIT_MS = Number(process.env.RATE_LIMIT_WAIT_MS ?? 61000);
const TIMEOUT = Number(process.env.TIMEOUT_MS ?? 15000);
const NO_OP_WAIT_MS = 500;

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name, detail) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, reason) {
    skipped += 1;
    console.log(`SKIP  ${name} — ${reason}`);
}
async function test(name, fn) {
    try {
        await fn();
        pass(name);
    } catch (error) {
        fail(name, error instanceof Error ? error.message : String(error));
    }
}
function check(condition, message) {
    if (!condition) throw new Error(message);
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function connect(token) {
    return new Promise((resolve, reject) => {
        const socket = io(BASE, {
            transports: ['websocket'],
            extraHeaders: { authorization: `Bearer ${token}` },
            auth: { token },
            reconnection: false,
            forceNew: true,
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('socket connect timed out'));
        }, 8000);
        socket.once('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.once('connect_error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
/** Resolve the raw ack so both success and failure are inspectable. */
function emitAck(socket, event, payload) {
    return new Promise((resolve) => {
        const timer = setTimeout(
            () => resolve({ ok: false, message: `${event} ack timed out` }),
            TIMEOUT,
        );
        socket.emit(event, payload, (response) => {
            clearTimeout(timer);
            resolve(response ?? { ok: false, message: 'empty ack' });
        });
    });
}
async function callOk(socket, event, payload) {
    const response = await emitAck(socket, event, payload);
    if (response.ok !== true) {
        throw new Error(`${event} failed: ${response.message}`);
    }
    return response.data;
}
function waitFor(socket, event, predicate, timeout = TIMEOUT) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`${event} not received`));
        }, timeout);
        const handler = (payload) => {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        };
        socket.on(event, handler);
    });
}
function snapshotOf(payload, messageId) {
    return payload && payload.messageId === messageId ? payload : null;
}
function hasKey(value, key) {
    if (Array.isArray(value)) return value.some((entry) => hasKey(entry, key));
    if (value && typeof value === 'object') {
        return Object.keys(value).includes(key) ||
            Object.values(value).some((entry) => hasKey(entry, key));
    }
    return false;
}
function reactionCount(snapshot, emoji) {
    const entry = (snapshot?.reactions ?? []).find((row) => row.emoji === emoji);
    return entry ? entry.count : 0;
}

async function expectFailure(name, response, fragment) {
    if (response.ok === true) {
        fail(name, 'request unexpectedly succeeded');
        return;
    }
    const message = String(response.message ?? '');
    if (fragment && !message.includes(fragment)) {
        fail(name, `expected "${fragment}", got "${message}"`);
        return;
    }
    pass(name, message);
}

async function main() {
    const missing = [];
    if (!BASE) missing.push('URL');
    if (!TOKEN_A) missing.push('TOKEN_A');
    if (!TOKEN_B) missing.push('TOKEN_B');
    if (!TOKEN_OUTSIDER) missing.push('TOKEN_OUTSIDER');
    if (!Number.isInteger(CHAT_ID) || CHAT_ID <= 0) missing.push('CHAT_ID');
    if (missing.length) {
        console.error(`Missing/invalid env: ${missing.join(', ')}`);
        process.exit(2);
    }

    const a = await connect(TOKEN_A);
    const b = await connect(TOKEN_B);
    const outsider = await connect(TOKEN_OUTSIDER);
    let banned = null;
    try {
        await callOk(a, 'joinChat', { chatId: CHAT_ID });
        await callOk(b, 'joinChat', { chatId: CHAT_ID });

        const stamp = Date.now();
        const message = await callOk(a, 'sendMessage', {
            chatId: CHAT_ID,
            content: `reaction-e2e-${stamp}`,
            type: 'text',
        });
        const messageId = message.id;

        check(Array.isArray(message.reactions), 'send ack has no reactions[]');
        check(message.reactions.length === 0, 'new message should have no reactions');
        check(!Object.hasOwn(message, 'myReaction'), 'send ack must not carry myReaction');

        // 1. B reacts 👍; both recipients get the personalized snapshot.
        const aSaw = waitFor(a, 'reaction:updated', (p) => snapshotOf(p, messageId));
        const bSaw = waitFor(b, 'reaction:updated', (p) => snapshotOf(p, messageId));
        const bAck = await callOk(b, 'reactMessage', {
            chatId: CHAT_ID,
            messageId,
            emoji: '👍',
        });
        const [aEvent, bEvent] = await Promise.all([aSaw, bSaw]);
        check(bAck.myReaction === '👍', 'B ack myReaction is not 👍');
        check(bEvent.myReaction === '👍', 'B event myReaction is not 👍');
        check(aEvent.myReaction === null, 'A event myReaction should be null');
        check(reactionCount(bEvent, '👍') === 1, '👍 count should be 1');
        check(!hasKey(bAck, 'userIds'), 'ack leaked userIds');
        pass('B reaction is personalized per receiver');

        // 2. A adds ❤️.
        await callOk(a, 'reactMessage', {
            chatId: CHAT_ID,
            messageId,
            emoji: '❤️',
        });
        const afterA = await callOk(b, 'getMessages', {
            chatId: CHAT_ID,
            limit: 30,
        });
        const fromB = afterA.messages.find((m) => m.id === messageId);
        check(fromB, 'message missing from history');
        check(reactionCount(fromB, '👍') === 1, '👍 disappeared too early');
        check(reactionCount(fromB, '❤️') === 1, '❤️ count should be 1');
        check(fromB.myReaction === '👍', 'history myReaction for B should be 👍');
        pass('A and B see the updated counts');

        // 3. B switches 👍 → ❤️.
        const switched = await callOk(b, 'reactMessage', {
            chatId: CHAT_ID,
            messageId,
            emoji: '❤️',
        });
        check(reactionCount(switched, '👍') === 0, '👍 should disappear');
        check(reactionCount(switched, '❤️') === 2, '❤️ count should be 2');
        check(switched.myReaction === '❤️', 'B myReaction should be ❤️');

        // 4. B toggles ❤️ off.
        const toggledOff = await callOk(b, 'reactMessage', {
            chatId: CHAT_ID,
            messageId,
            emoji: '❤️',
        });
        check(toggledOff.myReaction === null, 'B should have no reaction');
        check(reactionCount(toggledOff, '❤️') === 1, 'only A should remain on ❤️');
        check(toggledOff.actor.emoji === null, 'actor emoji should be null');
        pass('switching and toggle-off work');

        // 5. Clearing a non-existent reaction emits nothing.
        const quiet = await callOk(a, 'sendMessage', {
            chatId: CHAT_ID,
            content: `reaction-noop-${stamp}`,
            type: 'text',
        });
        let noOpEvents = 0;
        const noopHandler = (payload) => {
            if (snapshotOf(payload, quiet.id)) noOpEvents += 1;
        };
        a.on('reaction:updated', noopHandler);
        const noopAck = await callOk(a, 'reactMessage', {
            chatId: CHAT_ID,
            messageId: quiet.id,
            emoji: null,
        });
        await sleep(NO_OP_WAIT_MS);
        a.off('reaction:updated', noopHandler);
        if (noOpEvents === 0) pass('clearing a missing reaction emits nothing');
        else fail('clearing a missing reaction emits nothing', `${noOpEvents} events`);
        check(noopAck.myReaction === null, 'no-op myReaction should be null');

        // 6. Validation errors.
        await expectFailure(
            'unknown emoji rejected',
            await emitAck(b, 'reactMessage', {
                chatId: CHAT_ID,
                messageId,
                emoji: '🦄',
            }),
            'react not found',
        );

        if (CHAT_ID_OTHER > 0) {
            await callOk(b, 'joinChat', { chatId: CHAT_ID_OTHER });
            const otherChatMessage = await callOk(b, 'sendMessage', {
                chatId: CHAT_ID_OTHER,
                content: `reaction-other-chat-${stamp}`,
                type: 'text',
            });
            await expectFailure(
                'message from another chat rejected',
                await emitAck(b, 'reactMessage', {
                    chatId: CHAT_ID,
                    messageId: otherChatMessage.id,
                    emoji: '👍',
                }),
                'message not found',
            );
        } else {
            skip(
                'message from another chat rejected',
                'set CHAT_ID_OTHER to a chat both tokens belong to',
            );
        }

        const deleted = await callOk(a, 'sendMessage', {
            chatId: CHAT_ID,
            content: `reaction-deleted-${stamp}`,
            type: 'text',
        });
        await callOk(a, 'reactMessage', {
            chatId: CHAT_ID,
            messageId: deleted.id,
            emoji: '👍',
        });
        await callOk(a, 'deleteMessage', {
            chatId: CHAT_ID,
            messageId: deleted.id,
        });
        await expectFailure(
            'deleted message rejected',
            await emitAck(b, 'reactMessage', {
                chatId: CHAT_ID,
                messageId: deleted.id,
                emoji: '👍',
            }),
            'message not found',
        );
        await expectFailure(
            'reactor list rejects a deleted message',
            await emitAck(b, 'getMessageReactions', {
                chatId: CHAT_ID,
                messageId: deleted.id,
            }),
            'message not found',
        );

        // 7. Authorization.
        check(outsider.connected, 'outsider connection failed');
        await expectFailure(
            'outsider cannot react',
            await emitAck(outsider, 'reactMessage', {
                chatId: CHAT_ID,
                messageId,
                emoji: '👍',
            }),
            'member not found',
        );

        if (TOKEN_BANNED) {
            banned = await connect(TOKEN_BANNED);
            await expectFailure(
                'banned member cannot react',
                await emitAck(banned, 'reactMessage', {
                    chatId: CHAT_ID,
                    messageId,
                    emoji: '👍',
                }),
                'user cant access',
            );
        } else {
            skip('banned member cannot react', 'set TOKEN_BANNED');
        }

        // 8. 30 concurrent toggles from one user never duplicate a row.
        const burst = await callOk(a, 'sendMessage', {
            chatId: CHAT_ID,
            content: `reaction-burst-${stamp}`,
            type: 'text',
        });
        const burstResponses = await Promise.all(
            Array.from({ length: 30 }, () =>
                emitAck(a, 'reactMessage', {
                    chatId: CHAT_ID,
                    messageId: burst.id,
                    emoji: '👍',
                }),
            ),
        );
        check(
            burstResponses.every((response) => response.ok === true),
            'one of the 30 concurrent reactions failed',
        );
        let reactorList = await callOk(b, 'getMessageReactions', {
            chatId: CHAT_ID,
            messageId: burst.id,
        });
        let burstUsers = reactorList.reactions.reduce(
            (sum, group) => sum + group.users.length,
            0,
        );
        check(burstUsers <= 1, `concurrency produced ${burstUsers} rows`);
        if (burstUsers === 0) {
            await callOk(a, 'reactMessage', {
                chatId: CHAT_ID,
                messageId: burst.id,
                emoji: '👍',
            });
            reactorList = await callOk(b, 'getMessageReactions', {
                chatId: CHAT_ID,
                messageId: burst.id,
            });
            burstUsers = reactorList.reactions.reduce(
                (sum, group) => sum + group.users.length,
                0,
            );
        }
        check(burstUsers === 1, `expected exactly one row, found ${burstUsers}`);
        pass('30 concurrent reactions leave exactly one row');

        // 9. getMessages summary + personalization, edit echo, forwarding.
        const historyA = await callOk(a, 'getMessages', {
            chatId: CHAT_ID,
            limit: 50,
        });
        const historyB = await callOk(b, 'getMessages', {
            chatId: CHAT_ID,
            limit: 50,
        });
        const aMessage = historyA.messages.find((m) => m.id === messageId);
        const bMessageRow = historyB.messages.find((m) => m.id === messageId);
        check(aMessage && bMessageRow, 'history missing the reaction message');
        check(Array.isArray(aMessage.reactions), 'history missing reactions[]');
        check(aMessage.myReaction === '❤️', 'A myReaction should be ❤️');
        check(bMessageRow.myReaction === null, 'B myReaction should be null');
        check(
            aMessage.reactions.every(
                (row) => Object.keys(row).sort().join(',') === 'count,emoji',
            ),
            'history reaction rows must be {emoji,count} only',
        );
        pass('getMessages returns reactions and per-caller myReaction');

        const detail = await callOk(b, 'getMessageReactions', {
            chatId: CHAT_ID,
            messageId,
        });
        check(Array.isArray(detail.reactions), 'reactor list missing reactions[]');
        const totalUsers = detail.reactions.reduce(
            (sum, group) => sum + group.users.length,
            0,
        );
        check(totalUsers <= 100, `reactor list returned ${totalUsers} users`);
        check(!hasKey(detail, 'phone'), 'reactor list leaked a phone field');
        const user = detail.reactions.flatMap((group) => group.users)[0];
        check(user && user.userId > 0, 'reactor user missing userId');
        check(typeof user.name === 'string', 'reactor user missing name');
        check('avatars' in user, 'reactor user missing avatars');
        pass('getMessageReactions groups users without phone and respects 100');

        const editedAck = await callOk(a, 'editMessage', {
            chatId: CHAT_ID,
            messageId,
            newContent: `reaction-e2e-edited-${stamp}`,
        });
        check(
            reactionCount(editedAck, '❤️') === 1,
            'edit ack lost reactions',
        );
        const editedHistory = await callOk(b, 'getMessages', {
            chatId: CHAT_ID,
            limit: 50,
        });
        const editedRow = editedHistory.messages.find((m) => m.id === messageId);
        check(editedRow?.isEdited === true, 'edit not persisted');
        check(reactionCount(editedRow, '❤️') === 1, 'edit history lost reactions');
        pass('edit echo and history keep reactions');

        const forward = await callOk(b, 'forwardMessages', {
            fromChatId: CHAT_ID,
            messageIds: [messageId],
            toChatIds: [CHAT_ID],
            requestId: `reaction_fwd_${stamp}`,
        });
        const forwardedId = forward.results[0]?.messageIds?.[0];
        check(Number.isInteger(forwardedId), 'forward ack has no new id');
        const afterForward = await callOk(b, 'getMessages', {
            chatId: CHAT_ID,
            limit: 50,
        });
        const forwardedRow = afterForward.messages.find(
            (m) => m.id === forwardedId,
        );
        check(forwardedRow, 'forwarded message missing from history');
        check(
            Array.isArray(forwardedRow.reactions) &&
                forwardedRow.reactions.length === 0,
            'forward copied reactions',
        );
        pass('forwarding does not copy reactions');

        // 10. 60/min per user, then recovery after the window.
        const rateMessage = await callOk(a, 'sendMessage', {
            chatId: CHAT_ID,
            content: `reaction-rate-${stamp}`,
            type: 'text',
        });
        let limited = null;
        for (let index = 0; index < 80; index += 1) {
            const response = await emitAck(a, 'reactMessage', {
                chatId: CHAT_ID,
                messageId: rateMessage.id,
                emoji: '👍',
            });
            if (response.ok !== true) {
                limited = response;
                break;
            }
        }
        if (!limited) {
            fail('rate limit triggers', '80 reactions did not hit the limit');
        } else {
            const text = String(limited.message ?? '');
            if (text.toLowerCase().includes('too many')) {
                pass('rate limit triggers', text);
            } else {
                fail('rate limit triggers', text);
            }
            if (RATE_LIMIT_WAIT_MS > 0) {
                console.log(
                    `      waiting ${RATE_LIMIT_WAIT_MS}ms for the reaction window…`,
                );
                await sleep(RATE_LIMIT_WAIT_MS);
                const recovered = await emitAck(a, 'reactMessage', {
                    chatId: CHAT_ID,
                    messageId: rateMessage.id,
                    emoji: '👍',
                });
                if (recovered.ok === true) pass('rate limit recovers');
                else fail('rate limit recovers', recovered.message);
            } else {
                skip('rate limit recovers', 'RATE_LIMIT_WAIT_MS=0');
            }
        }
    } finally {
        a.close();
        b.close();
        outsider.close();
        banned?.close();
    }
}

main()
    .then(() => {
        console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
        if (failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
        console.error(`\nFAILED: ${errorText(error)}`);
        process.exitCode = 1;
    });
