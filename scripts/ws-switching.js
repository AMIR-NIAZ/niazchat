#!/usr/bin/env node
/**
 * Lost-live-update repro: room switching, reconnects and room-less sends.
 *
 * Replicates the app's REAL emit order (src/features/chats/chats-socket-api.ts,
 * src/features/messages/use-chat-messages.ts):
 *   focus  -> joinChat { chatId } (awaited) -> getMessages (awaited)
 *   blur   -> leaveChat { chatId } fire-and-forget (only if the screen still
 *             owns the room; a delayed cleanup can land after the next join)
 *   send   -> sendMessage + clientMessageId, confirmed by the ack and by the
 *             `sendMessage:list` echo (direct-to-sender when not in the room)
 *
 * Usage:
 *   URL=http://localhost:3000 TOKEN_A=<A> TOKEN_B=<B> \
 *   PV_CHAT_ID=<private chat of A+B> GROUP_CHAT_ID=<group of A+B> \
 *     node scripts/ws-switching.js
 *
 * Optional: ITER=200 (per scenario), TIMEOUT_MS=3000, SCENARIOS=a,b,...
 *
 * Exit code: 0 only when every scenario has ZERO lost events.
 */
'use strict';

const { io } = require('socket.io-client');

const URL = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A || '';
const TOKEN_B = process.env.TOKEN_B || '';
const PV_CHAT_ID = Number(process.env.PV_CHAT_ID);
const GROUP_CHAT_ID = Number(process.env.GROUP_CHAT_ID);
const ITER = Math.max(1, Number(process.env.ITER || 200));
const TIMEOUT_MS = Math.max(500, Number(process.env.TIMEOUT_MS || 3000));
/**
 * The server allows 60 reactions per user per minute (ReactionsService), so
 * reaction assertions run on every Nth send instead of every send. Sends are
 * still asserted on every iteration.
 */
const REACT_EVERY = Math.max(1, Number(process.env.REACT_EVERY || 5));
const EMOJIS = ['👍', '❤️', '😂', '😮'];

if (!TOKEN_A || !TOKEN_B) {
    console.error('Missing TOKEN_A / TOKEN_B');
    process.exit(1);
}
if (!Number.isInteger(PV_CHAT_ID) || PV_CHAT_ID <= 0) {
    console.error('PV_CHAT_ID must be a positive integer');
    process.exit(1);
}
if (!Number.isInteger(GROUP_CHAT_ID) || GROUP_CHAT_ID <= 0) {
    console.error('GROUP_CHAT_ID must be a positive integer');
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (max) => Math.floor(Math.random() * (max + 1));

function connect(token) {
    return new Promise((resolve, reject) => {
        const socket = io(URL, {
            extraHeaders: { authorization: `Bearer ${token}` },
            auth: { token },
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 200,
            reconnectionDelayMax: 1000,
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('connect timeout'));
        }, 10000);
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

function request(socket, event, payload, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`timeout waiting for "${event}" ack`));
        }, timeoutMs);
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

/** Buffer + wait: an event that arrived before we started waiting is not lost. */
class Peer {
    constructor(label, token) {
        this.label = label;
        this.token = token;
        this.socket = null;
        /** The chat room this client believes it owns (app's active-room marker). */
        this.activeChatId = null;
        this.buffer = [];
        this.connected = 0;
    }

    async open() {
        this.socket = await connect(this.token);
        this.socket.on('sendMessage:list', (message) => {
            this.buffer.push({ event: 'sendMessage:list', payload: message });
        });
        this.socket.on('reaction:updated', (snapshot) => {
            this.buffer.push({ event: 'reaction:updated', payload: snapshot });
        });
        return this;
    }

    async close() {
        if (this.socket !== null) {
            this.socket.close();
            this.socket = null;
        }
        this.activeChatId = null;
    }

    clearBuffer() {
        this.buffer.length = 0;
    }

    // The app joins on focus: joinChat ack, then the first history page.
    async focus(chatId) {
        this.activeChatId = chatId;
        await request(this.socket, 'joinChat', { chatId });
        await request(this.socket, 'getMessages', { chatId });
    }

    // The app blur: only the screen that still owns the room may leave it.
    // `delayMs` reproduces a cleanup landing AFTER the next join.
    blur(chatId, delayMs = 0) {
        if (this.activeChatId !== chatId) {
            return Promise.resolve(false);
        }
        this.activeChatId = null;
        const emit = () =>
            this.socket !== null &&
            this.socket.emit('leaveChat', { chatId }, () => {});
        if (delayMs <= 0) {
            emit();
            return Promise.resolve(true);
        }
        return sleep(delayMs).then(() => {
            emit();
            return true;
        });
    }

    isIn(chatId) {
        return this.activeChatId === chatId;
    }

    /**
     * Wait for an event matching `predicate`; scans events already buffered.
     * Returns null on timeout.
     */
    waitFor(event, predicate, timeoutMs = TIMEOUT_MS) {
        const index = this.buffer.findIndex(
            (entry) =>
                entry.event === event && predicate(entry.payload),
        );
        if (index >= 0) {
            const [entry] = this.buffer.splice(index, 1);
            return Promise.resolve(entry.payload);
        }
        const socket = this.socket;
        return new Promise((resolve) => {
            const handler = (payload) => {
                if (!predicate(payload)) return;
                clearTimeout(timer);
                socket.off(event, handler);
                const buffered = this.buffer.findIndex(
                    (entry) =>
                        entry.event === event && entry.payload === payload,
                );
                if (buffered >= 0) this.buffer.splice(buffered, 1);
                resolve(payload);
            };
            const timer = setTimeout(() => {
                socket.off(event, handler);
                resolve(null);
            }, timeoutMs);
            socket.on(event, handler);
        });
    }
}

class Stats {
    constructor(name) {
        this.name = name;
        this.iterations = 0;
        this.senderEchoLost = 0;
        this.receiverEchoLost = 0;
        this.senderReactionLost = 0;
        this.receiverReactionLost = 0;
        this.ackMismatch = 0;
        this.receiverChecks = 0;
        this.reactionChecks = 0;
        this.receiverReactionChecks = 0;
        this.failures = [];
    }

    record(failure) {
        if (failure === null) return;
        this.failures.push(failure);
        switch (failure) {
            case 'sender-echo':
                this.senderEchoLost += 1;
                break;
            case 'receiver-echo':
                this.receiverEchoLost += 1;
                break;
            case 'sender-reaction':
                this.senderReactionLost += 1;
                break;
            case 'receiver-reaction':
                this.receiverReactionLost += 1;
                break;
            case 'ack-mismatch':
                this.ackMismatch += 1;
                break;
            default:
                break;
        }
    }

    print() {
        const totalLost =
            this.senderEchoLost +
            this.receiverEchoLost +
            this.senderReactionLost +
            this.receiverReactionLost +
            this.ackMismatch;
        const rate = (count, base) =>
            base === 0 ? '0.00%' : `${((count / base) * 100).toFixed(2)}%`;
        console.log(`\n== ${this.name} (${this.iterations} iterations) ==`);
        console.log(
            `  sender sendMessage:list lost    : ${this.senderEchoLost} (${rate(
                this.senderEchoLost,
                this.iterations,
            )})`,
        );
        console.log(
            `  receiver sendMessage:list lost  : ${this.receiverEchoLost}/${this.receiverChecks} (${rate(
                this.receiverEchoLost,
                this.receiverChecks,
            )})`,
        );
        console.log(
            `  sender reaction:updated lost    : ${this.senderReactionLost}/${this.reactionChecks} (${rate(
                this.senderReactionLost,
                this.reactionChecks,
            )})`,
        );
        console.log(
            `  receiver reaction:updated lost  : ${this.receiverReactionLost}/${this.receiverReactionChecks} (${rate(
                this.receiverReactionLost,
                this.receiverReactionChecks,
            )})`,
        );
        console.log(`  ack id mismatch                 : ${this.ackMismatch}`);
        console.log(
            `  TOTAL LOSS RATE                 : ${rate(
                totalLost,
                this.iterations +
                    this.receiverChecks +
                    this.reactionChecks +
                    this.receiverReactionChecks,
            )}`,
        );
        return totalLost;
    }
}

/** Global per-user reaction timestamps: the server caps 60 per minute. */
const reactionTimes = [];

async function reactionSlot() {
    for (;;) {
        const now = Date.now();
        while (reactionTimes.length > 0 && now - reactionTimes[0] >= 60_000) {
            reactionTimes.shift();
        }
        if (reactionTimes.length < 50) return;
        await sleep(60_000 - (now - reactionTimes[0]) + 50);
    }
}

let seq = 0;

/**
 * One app-like exchange: A (optionally in a room) sends in `chatId`, then
 * reacts. Asserts the echo and reaction reach A, and B when B is in the room.
 */
async function exchange(a, b, chatId, stats, options = {}) {
    const { expectReceiver = b.isIn(chatId), checkReactions = true } = options;
    const cid = `switch-${process.pid}-${Date.now()}-${(seq += 1)}`;
    const emoji = EMOJIS[seq % EMOJIS.length];
    stats.iterations += 1;

    const senderEcho = a.waitFor(
        'sendMessage:list',
        (message) => message && message.clientMessageId === cid,
    );
    const receiverEcho = expectReceiver
        ? b.waitFor(
              'sendMessage:list',
              (message) => message && message.clientMessageId === cid,
          )
        : Promise.resolve('skip');

    let ack = null;
    try {
        ack = await request(a.socket, 'sendMessage', {
            chatId,
            content: `switch ${cid}`,
            clientMessageId: cid,
        });
    } catch (error) {
        stats.record('sender-echo');
        if (expectReceiver) stats.record('receiver-echo');
        return `send rejected: ${error.message}`;
    }

    const [aEcho, bEcho] = await Promise.all([senderEcho, receiverEcho]);
    if (aEcho === null) stats.record('sender-echo');
    if (expectReceiver) {
        stats.receiverChecks += 1;
        if (bEcho === null) stats.record('receiver-echo');
    }
    const ackId = Number(ack && ack.id);
    if (!Number.isInteger(ackId) || !ackId) {
        stats.record('ack-mismatch');
        return 'ack without a message id';
    }

    if (!checkReactions) return null;

    // The ack alone confirms the bubble in the app; the echo must also arrive.
    await reactionSlot();
    stats.reactionChecks += 1;
    if (expectReceiver) stats.receiverReactionChecks += 1;
    const senderReaction = a.waitFor(
        'reaction:updated',
        (snapshot) => snapshot && Number(snapshot.messageId) === ackId,
    );
    const receiverReaction = expectReceiver
        ? b.waitFor(
              'reaction:updated',
              (snapshot) => snapshot && Number(snapshot.messageId) === ackId,
          )
        : Promise.resolve('skip');

    try {
        await request(a.socket, 'reactMessage', {
            chatId,
            messageId: ackId,
            emoji,
        });
        reactionTimes.push(Date.now());
    } catch (error) {
        stats.record('sender-reaction');
        if (expectReceiver) stats.record('receiver-reaction');
        return `react rejected: ${error.message}`;
    }

    const [aReaction, bReaction] = await Promise.all([
        senderReaction,
        receiverReaction,
    ]);
    if (aReaction === null) stats.record('sender-reaction');
    if (expectReceiver && bReaction === null) {
        stats.record('receiver-reaction');
    }
    return null;
}

const SCENARIOS = {
    async 'group-only'(stats) {
        const a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        try {
            await a.focus(GROUP_CHAT_ID);
            await b.focus(GROUP_CHAT_ID);
            for (let i = 0; i < ITER; i += 1) {
                a.clearBuffer();
                b.clearBuffer();
                const failure = await exchange(a, b, GROUP_CHAT_ID, stats, {
                    checkReactions: i % REACT_EVERY === 0,
                });
                if (failure !== null && stats.failures.length < 3) {
                    console.log(`   [${stats.name}] ${failure}`);
                }
            }
        } finally {
            await a.close();
            await b.close();
        }
    },

    async 'private-only'(stats) {
        const a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        try {
            await a.focus(PV_CHAT_ID);
            await b.focus(PV_CHAT_ID);
            for (let i = 0; i < ITER; i += 1) {
                a.clearBuffer();
                b.clearBuffer();
                const failure = await exchange(a, b, PV_CHAT_ID, stats, {
                    checkReactions: i % REACT_EVERY === 0,
                });
                if (failure !== null && stats.failures.length < 3) {
                    console.log(`   [${stats.name}] ${failure}`);
                }
            }
        } finally {
            await a.close();
            await b.close();
        }
    },

    async mixed(stats) {
        const chats = [PV_CHAT_ID, GROUP_CHAT_ID];
        const a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        const pendingLeaves = [];
        try {
            let aChat = PV_CHAT_ID;
            let bChat = PV_CHAT_ID;
            await a.focus(aChat);
            await b.focus(bChat);
            for (let i = 0; i < ITER; i += 1) {
                const nextA = chats[jitter(1)];
                if (nextA !== aChat) {
                    // App order: blur (delayed cleanup 0..300ms) then focus.
                    const previous = aChat;
                    pendingLeaves.push(a.blur(previous, jitter(300)));
                    aChat = nextA;
                }
                await a.focus(aChat);

                // The other user follows the same conversation.
                if (bChat !== aChat) {
                    const previous = bChat;
                    await b.blur(previous);
                    bChat = aChat;
                }
                await b.focus(bChat);

                a.clearBuffer();
                b.clearBuffer();
                const failure = await exchange(a, b, aChat, stats, {
                    checkReactions: i % REACT_EVERY === 0,
                });
                if (failure !== null && stats.failures.length < 3) {
                    console.log(`   [${stats.name}] ${failure}`);
                }
                // Let the delayed stale leave land before the next exchange.
                await Promise.all(pendingLeaves.splice(0));
            }
        } finally {
            await Promise.allSettled(pendingLeaves);
            await a.close();
            await b.close();
        }
    },

    async 'reconnect-same-instance'(stats) {
        const a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        try {
            await a.focus(GROUP_CHAT_ID);
            await b.focus(GROUP_CHAT_ID);
            for (let i = 0; i < ITER; i += 1) {
                a.clearBuffer();
                b.clearBuffer();
                // Transport loss: reconnection is automatic; the app refetches
                // and re-joins the focused chat on `connect`.
                const reconnected = new Promise((resolve) => {
                    a.socket.once('connect', resolve);
                });
                a.socket.disconnect();
                a.socket.connect();
                await reconnected;
                await a.focus(a.activeChatId ?? GROUP_CHAT_ID);
                const failure = await exchange(a, b, GROUP_CHAT_ID, stats, {
                    checkReactions: i % REACT_EVERY === 0,
                });
                if (failure !== null && stats.failures.length < 3) {
                    console.log(`   [${stats.name}] ${failure}`);
                }
            }
        } finally {
            await a.close();
            await b.close();
        }
    },

    async 'new-instance-after-refresh'(stats) {
        let a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        try {
            await b.focus(GROUP_CHAT_ID);
            for (let i = 0; i < ITER; i += 1) {
                // Token refresh replaces the socket instance (app reconnectSocket
                // keeps the instance today, but a re-login/new instance must work).
                await a.close();
                a = await new Peer('A', TOKEN_A).open();
                await a.focus(GROUP_CHAT_ID);
                a.clearBuffer();
                b.clearBuffer();
                const failure = await exchange(a, b, GROUP_CHAT_ID, stats, {
                    checkReactions: i % REACT_EVERY === 0,
                });
                if (failure !== null && stats.failures.length < 3) {
                    console.log(`   [${stats.name}] ${failure}`);
                }
            }
        } finally {
            await a.close();
            await b.close();
        }
    },

    async 'connected-not-in-room'(stats) {
        const a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        try {
            // A is connected but (after a stale leave) in no room at all.
            await a.blur(PV_CHAT_ID);
            await b.focus(PV_CHAT_ID);
            for (let i = 0; i < ITER; i += 1) {
                a.clearBuffer();
                b.clearBuffer();
                const failure = await exchange(a, b, PV_CHAT_ID, stats, {
                    checkReactions: i % REACT_EVERY === 0,
                });
                if (failure !== null && stats.failures.length < 3) {
                    console.log(`   [${stats.name}] ${failure}`);
                }
            }
        } finally {
            await a.close();
            await b.close();
        }
    },

    /**
     * Root-cause repro of the PRE-FIX client: a chat screen that becomes
     * visible again after another chat was opened on the same socket does NOT
     * re-join. The server keeps one room per socket, so the visible chat
     * silently misses the peer's messages until something else re-joins.
     * Run with INCLUDE_LEGACY=1; it is expected to LOSE events by design.
     */
    async 'legacy-no-rejoin'(stats) {
        const a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        try {
            await a.focus(PV_CHAT_ID);
            await b.focus(PV_CHAT_ID);
            for (let i = 0; i < ITER; i += 1) {
                // A opens the group (the private screen stays mounted below).
                await a.focus(GROUP_CHAT_ID);
                // A returns to the private screen WITHOUT joining again.
                a.activeChatId = GROUP_CHAT_ID;
                a.clearBuffer();
                b.clearBuffer();
                // B sends into the chat A is looking at: A is not in the room.
                await exchange(b, a, PV_CHAT_ID, stats, {
                    expectReceiver: true,
                    checkReactions: false,
                });
            }
        } finally {
            await a.close();
            await b.close();
        }
    },

    async 'idle-other-user'(stats) {
        const a = await new Peer('A', TOKEN_A).open();
        const b = await new Peer('B', TOKEN_B).open();
        try {
            await a.focus(PV_CHAT_ID);
            // B is connected and completely idle: no join, no listeners' input.
            for (let i = 0; i < ITER; i += 1) {
                a.clearBuffer();
                b.clearBuffer();
                const failure = await exchange(a, b, PV_CHAT_ID, stats, {
                    expectReceiver: false,
                    checkReactions: i % REACT_EVERY === 0,
                });
                if (failure !== null && stats.failures.length < 3) {
                    console.log(`   [${stats.name}] ${failure}`);
                }
            }
        } finally {
            await a.close();
            await b.close();
        }
    },
};

async function main() {
    const only = process.env.SCENARIOS
        ? new Set(process.env.SCENARIOS.split(',').map((name) => name.trim()))
        : null;
    console.log(
        `URL=${URL} ITER=${ITER} PV=${PV_CHAT_ID} GROUP=${GROUP_CHAT_ID}`,
    );

    let totalLost = 0;
    const includeLegacy = process.env.INCLUDE_LEGACY === '1';
    const names = Object.keys(SCENARIOS).filter(
        (name) =>
            (only === null || only.has(name)) &&
            (name !== 'legacy-no-rejoin' || includeLegacy),
    );
    for (const name of names) {
        const stats = new Stats(name);
        const started = Date.now();
        await SCENARIOS[name](stats);
        totalLost += stats.print();
        console.log(`  (${Date.now() - started} ms)`);
    }

    console.log(
        totalLost === 0
            ? '\nZERO LOST EVENTS in every scenario'
            : `\n${totalLost} LOST EVENT(S)`,
    );
    process.exitCode = totalLost === 0 ? 0 : 1;
}

main().catch((error) => {
    console.error(`FAILED: ${error instanceof Error ? error.stack : error}`);
    process.exitCode = 1;
});
