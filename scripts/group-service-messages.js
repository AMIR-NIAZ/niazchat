#!/usr/bin/env node
/*
 * End-to-end check for group SERVICE (`system`) messages.
 *
 * Covers: join via invite link, join/add by an admin, leave, ban and kick each
 * creating exactly one `system` message with the right `meta`; live delivery
 * to the remaining members; history persistence; unread counts unchanged;
 * idempotent repeats creating nothing; reply/react to a service message → 400.
 *
 * Env:
 *   URL            API origin (default http://localhost:3000)
 *   TOKEN_OWNER    owner of the throwaway group
 *   TOKEN_MEMBER   regular member (leaves in the run)
 *   TOKEN_BANNED   user who joins via link and is then banned
 *   TOKEN_JOINER   user added by an admin (then removed)
 *   ADD_PHONE      phone number of TOKEN_JOINER (for the add-by-phone route)
 *
 * No dependencies beyond the project's `socket.io-client`.
 */

/* eslint-disable no-console */
const { io } = require('socket.io-client');

const BASE = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_OWNER = process.env.TOKEN_OWNER;
const TOKEN_MEMBER = process.env.TOKEN_MEMBER;
const TOKEN_BANNED = process.env.TOKEN_BANNED;
const TOKEN_JOINER = process.env.TOKEN_JOINER;
const ADD_PHONE = process.env.ADD_PHONE;

if (
    !TOKEN_OWNER ||
    !TOKEN_MEMBER ||
    !TOKEN_BANNED ||
    !TOKEN_JOINER ||
    !ADD_PHONE
) {
    console.error(
        'Missing env: TOKEN_OWNER, TOKEN_MEMBER, TOKEN_BANNED, TOKEN_JOINER and ADD_PHONE are required.',
    );
    process.exit(1);
}

let failures = 0;

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`PASS ${name}`);
    } else {
        failures += 1;
        console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeUserId(token) {
    const part = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return Number(payload.sub ?? payload.userId ?? payload.id);
}

async function api(method, path, options = {}) {
    const headers = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body;
    if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(options.body);
    }
    const response = await fetch(`${BASE}${path}`, { method, headers, body });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text === '' ? null : JSON.parse(text);
    } catch {
        parsed = null;
    }
    return { status: response.status, body: parsed, text };
}

function connect(token) {
    return new Promise((resolve, reject) => {
        const socket = io(BASE, {
            transports: ['websocket'],
            extraHeaders: { authorization: `Bearer ${token}` },
            reconnection: false,
            timeout: 10000,
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('socket connect timed out'));
        }, 15000);
        socket.on('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.on('connect_error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function wsRequest(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${event} timed out`)),
            10000,
        );
        socket.emit(event, payload, (response) => {
            clearTimeout(timer);
            if (response && response.ok === true) resolve(response.data);
            else
                reject(
                    new Error(
                        (response && response.message) ||
                            `${event} failed`,
                    ),
                );
        });
    });
}

/** Buffered listener: events that arrived before `wait` are still found. */
function collector(socket, event) {
    const items = [];
    const waiters = [];
    const handler = (payload) => {
        items.push(payload);
        for (let index = waiters.length - 1; index >= 0; index -= 1) {
            const waiter = waiters[index];
            if (waiter.predicate(payload)) {
                waiters.splice(index, 1);
                clearTimeout(waiter.timer);
                waiter.resolve(payload);
            }
        }
    };
    socket.on(event, handler);
    return {
        reset: () => items.splice(0, items.length),
        all: () => [...items],
        wait: (predicate, timeoutMs = 6000) =>
            new Promise((resolve, reject) => {
                const existing = items.find(predicate);
                if (existing !== undefined) {
                    resolve(existing);
                    return;
                }
                const waiter = { predicate, resolve, timer: null };
                waiter.timer = setTimeout(() => {
                    const index = waiters.indexOf(waiter);
                    if (index >= 0) waiters.splice(index, 1);
                    reject(new Error(`timed out waiting for ${event}`));
                }, timeoutMs);
                waiters.push(waiter);
            }),
        close: () => socket.off(event, handler),
    };
}

async function members(chatId, token) {
    const response = await api('GET', `/chats/${chatId}/members?limit=100`, {
        token,
    });
    return response.body?.items ?? [];
}

async function unreadCount(chatId, socket) {
    const chats = (await wsRequest(socket, 'getAllChats')) ?? [];
    return Number(
        chats.find((row) => Number(row.id) === Number(chatId))?.unreadCount ??
            0,
    );
}

/** Latest page of history; only the system rows matter here. */
async function systemMessages(chatId, socket) {
    const page = await wsRequest(socket, 'getMessages', { chatId, limit: 100 });
    return (page?.messages ?? []).filter(
        (message) => message.type?.name === 'system',
    );
}

function serviceOf(message) {
    return message?.meta ?? null;
}

function countAction(messages, action) {
    return messages.filter((message) => serviceOf(message)?.action === action)
        .length;
}

async function main() {
    const ownerId = decodeUserId(TOKEN_OWNER);
    const memberId = decodeUserId(TOKEN_MEMBER);
    const bannedId = decodeUserId(TOKEN_BANNED);
    const joinerId = decodeUserId(TOKEN_JOINER);

    console.log(`Group service messages E2E against ${BASE}`);

    const sockets = {};
    try {
        sockets.owner = await connect(TOKEN_OWNER);
        sockets.member = await connect(TOKEN_MEMBER);
        sockets.banned = await connect(TOKEN_BANNED);
        sockets.joiner = await connect(TOKEN_JOINER);
    } catch (error) {
        console.error(`FAIL could not connect sockets — ${error.message}`);
        process.exit(1);
    }

    const live = {
        owner: collector(sockets.owner, 'sendMessage:list'),
        member: collector(sockets.member, 'sendMessage:list'),
        banned: collector(sockets.banned, 'sendMessage:list'),
        joiner: collector(sockets.joiner, 'sendMessage:list'),
    };
    const previews = collector(sockets.owner, 'chatlist:updated');

    try {
        const title = `Service ${String(Date.now()).slice(-8)}`;
        const created = await api('POST', '/chats/create', {
            token: TOKEN_OWNER,
            body: {
                title,
                members: [memberId]
                    .filter((id) => id !== ownerId)
                    .map(String),
            },
        });
        check('create group returns 2xx', created.status < 300, created.text);

        const chats = (await wsRequest(sockets.owner, 'getAllChats')) ?? [];
        const chat = chats.find(
            (row) => row.title === title && row.type === 'groupe',
        );
        if (!chat) {
            console.error('FAIL group created but not found in getAllChats');
            process.exit(1);
        }
        const chatId = Number(chat.id);
        for (const name of ['owner', 'member']) {
            await wsRequest(sockets[name], 'joinChat', { chatId });
        }

        // ── 1. admin adds a member (member_added, live for the target) ─────
        const beforeAdd = await unreadCount(chatId, sockets.owner);
        const added = await api(
            'POST',
            `/chats/manage/${chatId}/add/${encodeURIComponent(ADD_PHONE)}`,
            { token: TOKEN_OWNER },
        );
        check(
            'admin adds a member (2xx)',
            added.status < 300,
            added.text,
        );
        let liveAdd;
        try {
            liveAdd = await live.joiner.wait(
                (message) =>
                    Number(message.chatId) === chatId &&
                    message.type?.name === 'system' &&
                    serviceOf(message)?.action === 'member_added',
            );
        } catch (error) {
            liveAdd = null;
            check('added user receives member_added live', false, error.message);
        }
        if (liveAdd) {
            check('added user receives member_added live', true);
            check(
                'member_added meta snapshots are correct',
                Number(serviceOf(liveAdd).actorId) === ownerId &&
                    Number(serviceOf(liveAdd).targetId) === joinerId &&
                    serviceOf(liveAdd).targetName.length > 0,
                JSON.stringify(serviceOf(liveAdd)),
            );
        }
        await wsRequest(sockets.joiner, 'joinChat', { chatId });
        await sleep(200);
        check(
            'service message does not change unread count',
            (await unreadCount(chatId, sockets.owner)) === beforeAdd,
        );

        // ── 2. repeat add creates nothing (409) ───────────────────────────
        const repeatAdd = await api(
            'POST',
            `/chats/manage/${chatId}/add/${encodeURIComponent(ADD_PHONE)}`,
            { token: TOKEN_OWNER },
        );
        check(
            'repeated add is refused',
            repeatAdd.status === 409,
            repeatAdd.text,
        );

        // ── 3. kick / remove (member_removed) ─────────────────────────────
        let rows = await members(chatId, TOKEN_OWNER);
        const joinerRow = rows.find((row) => Number(row.userId) === joinerId);
        const kicked = await api(
            'DELETE',
            `/chats/${chatId}/members/${joinerRow?.memberId}`,
            { token: TOKEN_OWNER },
        );
        check('owner removes the member (2xx)', kicked.status < 300, kicked.text);
        try {
            await live.owner.wait(
                (message) =>
                    Number(message.chatId) === chatId &&
                    serviceOf(message)?.action === 'member_removed' &&
                    Number(serviceOf(message).targetId) === joinerId,
            );
            check('remaining members receive member_removed live', true);
        } catch (error) {
            check(
                'remaining members receive member_removed live',
                false,
                error.message,
            );
        }

        // ── 4. join via invite link (member_joined_via_link) ──────────────
        const link = await api('POST', `/chats/${chatId}/invite-links`, {
            token: TOKEN_OWNER,
            body: {},
        });
        check('owner creates an invite link', link.status < 300, link.text);
        const code = link.body?.code;
        const joined = await api('POST', `/invites/${code}/join`, {
            token: TOKEN_BANNED,
        });
        check(
            'user joins via invite link',
            joined.status < 300 && joined.body?.joined === true,
            joined.text,
        );
        try {
            const event = await live.banned.wait(
                (message) =>
                    Number(message.chatId) === chatId &&
                    serviceOf(message)?.action === 'member_joined_via_link' &&
                    Number(serviceOf(message).targetId) === bannedId,
            );
            check('joining user receives member_joined_via_link live', true);
            check(
                'join-via-link row is serialized with the normal message shape',
                typeof event.id === 'number' &&
                    Number(event.senderId) === bannedId,
            );
        } catch (error) {
            check(
                'joining user receives member_joined_via_link live',
                false,
                error.message,
            );
        }
        await wsRequest(sockets.banned, 'joinChat', { chatId });

        // Idempotent repeat: already a member, joined=false, nothing created.
        live.banned.reset();
        const repeatJoin = await api('POST', `/invites/${code}/join`, {
            token: TOKEN_BANNED,
        });
        await sleep(400);
        check(
            'repeated join is idempotent and creates no message',
            repeatJoin.status < 300 &&
                repeatJoin.body?.joined === false &&
                live.banned.all().length === 0,
            repeatJoin.text,
        );

        // ── 5. ban (member_banned, live for the others, not the target) ───
        rows = await members(chatId, TOKEN_OWNER);
        const bannedRow = rows.find((row) => Number(row.userId) === bannedId);
        const banned = await api(
            'POST',
            `/chats/${chatId}/members/${bannedRow?.memberId}/ban`,
            { token: TOKEN_OWNER },
        );
        check('owner bans the member (2xx)', banned.status < 300, banned.text);
        try {
            await live.owner.wait(
                (message) =>
                    Number(message.chatId) === chatId &&
                    serviceOf(message)?.action === 'member_banned' &&
                    Number(serviceOf(message).targetId) === bannedId,
            );
            check('members receive member_banned live', true);
        } catch (error) {
            check('members receive member_banned live', false, error.message);
        }
        const repeatBan = await api(
            'POST',
            `/chats/${chatId}/members/${bannedRow?.memberId}/ban`,
            { token: TOKEN_OWNER },
        );
        check(
            'repeated ban is refused (already banned)',
            repeatBan.status === 409,
            repeatBan.text,
        );

        // ── 6. leave (member_left) ────────────────────────────────────────
        const left = await api('POST', `/chats/manage/${chatId}/leave`, {
            token: TOKEN_MEMBER,
        });
        check('member leaves (2xx)', left.status < 300, left.text);
        try {
            await live.owner.wait(
                (message) =>
                    Number(message.chatId) === chatId &&
                    serviceOf(message)?.action === 'member_left' &&
                    Number(serviceOf(message).targetId) === memberId,
            );
            check('members receive member_left live', true);
        } catch (error) {
            check('members receive member_left live', false, error.message);
        }

        // ── 7. history + previews + exactly one row per action ────────────
        await sleep(300);
        const history = await systemMessages(chatId, sockets.owner);
        for (const action of [
            'member_added',
            'member_removed',
            'member_joined_via_link',
            'member_banned',
            'member_left',
        ]) {
            check(
                `history has exactly one ${action} system message`,
                countAction(history, action) === 1,
                `got ${countAction(history, action)}`,
            );
        }
        check(
            'service messages carry a fallback content sentence',
            history.every(
                (message) =>
                    typeof message.content === 'string' &&
                    message.content.length > 0,
            ),
        );
        const lastMessage = (await wsRequest(sockets.owner, 'getAllChats'))
            ?.find((row) => Number(row.id) === chatId)?.lastMessage;
        check(
            'chat-list last message exposes type + meta',
            lastMessage?.type === 'system' && lastMessage?.meta?.action != null,
            JSON.stringify(lastMessage),
        );
        check(
            'chat-list preview updated for the owner',
            previews
                .all()
                .some(
                    (payload) =>
                        Number(payload.chatId) === chatId &&
                        payload.lastMessage?.type === 'system',
                ),
        );

        // ── 8. reply / react to a system message → 400 ────────────────────
        const target = history[history.length - 1];
        let replyError = '';
        try {
            await wsRequest(sockets.owner, 'sendMessage', {
                chatId,
                content: 'reply attempt',
                reply: Number(target.id),
            });
        } catch (error) {
            replyError = error.message;
        }
        check(
            'reply to a system message is rejected',
            replyError.includes('system messages cannot be replied to'),
            replyError,
        );
        let reactError = '';
        try {
            await wsRequest(sockets.owner, 'reactMessage', {
                chatId,
                messageId: Number(target.id),
                emoji: '👍',
            });
        } catch (error) {
            reactError = error.message;
        }
        check(
            'reaction to a system message is rejected',
            reactError.includes('system messages cannot be reacted to'),
            reactError,
        );
    } finally {
        for (const socket of Object.values(sockets)) socket.close();
        for (const value of Object.values(live)) value.close();
        previews.close();
    }

    console.log(
        failures === 0
            ? '\nALL CHECKS PASSED'
            : `\n${failures} CHECK(S) FAILED`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(`FAIL unexpected error — ${error.message}`);
    process.exit(1);
});
