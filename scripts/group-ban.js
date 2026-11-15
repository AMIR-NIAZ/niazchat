#!/usr/bin/env node
/*
 * End-to-end check for "Ban a member" (docs/mobile-api/groups.md).
 *
 * Env:
 *   URL              API origin (default http://localhost:3000)
 *   TOKEN_OWNER      owner token
 *   TOKEN_ADMIN      token of a user who will be promoted to admin
 *   TOKEN_MEMBER     token of a regular member (banned/unbanned in the run)
 *   TOKEN_OUTSIDER   token of another regular member (banned by the owner)
 *
 * The script creates its own group through the normal API, promotes the admin
 * through the panel endpoint and prints PASS/FAIL lines. Exit code 1 on any
 * failure. No dependencies beyond the project's `socket.io-client`.
 */

/* eslint-disable no-console */
const { io } = require('socket.io-client');

const BASE = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_OWNER = process.env.TOKEN_OWNER;
const TOKEN_ADMIN = process.env.TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TOKEN_MEMBER;
const TOKEN_OUTSIDER = process.env.TOKEN_OUTSIDER;

if (!TOKEN_OWNER || !TOKEN_ADMIN || !TOKEN_MEMBER || !TOKEN_OUTSIDER) {
    console.error(
        'Missing env: TOKEN_OWNER, TOKEN_ADMIN, TOKEN_MEMBER and TOKEN_OUTSIDER are required.',
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
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body,
    });
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

/** Buffered listener: events that arrive before `wait` are still found. */
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
        reset: () => {
            items.length = 0;
        },
        wait: (predicate, timeoutMs = 5000) =>
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

/**
 * The message gateway's ban guard throws a WsException (an `exception` event,
 * no ack), so "refused" means either an ack error or that event.
 */
function wsSendExpectRefusal(socket, payload) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (refused) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.off('exception', onException);
            resolve(refused);
        };
        const onException = () => finish(true);
        const timer = setTimeout(() => finish(false), 6000);
        socket.on('exception', onException);
        socket.emit('sendMessage', payload, (response) => {
            finish(!(response && response.ok === true));
        });
    });
}

async function members(chatId, token) {
    const response = await api('GET', `/chats/${chatId}/members?limit=100`, {
        token,
    });
    return response.body?.items ?? [];
}

async function banned(chatId, token) {
    const response = await api('GET', `/chats/${chatId}/banned?limit=100`, {
        token,
    });
    return response.body?.items ?? [];
}

function ban(token, chatId, memberId) {
    return api('POST', `/chats/${chatId}/members/${memberId}/ban`, { token });
}

async function main() {
    const ownerId = decodeUserId(TOKEN_OWNER);
    const adminId = decodeUserId(TOKEN_ADMIN);
    const memberId = decodeUserId(TOKEN_MEMBER);
    const outsiderId = decodeUserId(TOKEN_OUTSIDER);

    console.log(`Group ban E2E against ${BASE}`);

    const sockets = {};
    try {
        sockets.owner = await connect(TOKEN_OWNER);
        sockets.admin = await connect(TOKEN_ADMIN);
        sockets.member = await connect(TOKEN_MEMBER);
        sockets.outsider = await connect(TOKEN_OUTSIDER);
    } catch (error) {
        console.error(`FAIL could not connect sockets — ${error.message}`);
        process.exit(1);
    }

    const changes = {};
    const removals = {};
    for (const [name, socket] of Object.entries(sockets)) {
        changes[name] = collector(socket, 'group:changed');
        removals[name] = collector(socket, 'group:removed');
    }

    try {
        const title = `Ban ${String(Date.now()).slice(-8)}`;
        const created = await api('POST', '/chats/create', {
            token: TOKEN_OWNER,
            body: {
                title,
                members: [adminId, memberId, outsiderId]
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

        const rows = await members(chatId, TOKEN_OWNER);
        const rowOf = (userId) =>
            rows.find((row) => Number(row.userId) === userId);
        const ownerRow = rowOf(ownerId);
        const adminRow = rowOf(adminId);
        const memberRow = rowOf(memberId);
        const outsiderRow = rowOf(outsiderId);
        check(
            'all four users are members of the new group',
            [ownerRow, adminRow, memberRow, outsiderRow].every(
                (row) => row !== undefined,
            ),
        );

        const promoted = await api(
            'POST',
            `/chats/${chatId}/members/${adminRow.memberId}/promote`,
            { token: TOKEN_OWNER },
        );
        check(
            'owner promotes the admin (default permissions include ban_user)',
            promoted.status < 300 && promoted.body?.role === 'admin',
            promoted.text,
        );

        // `group:changed` is a chat-room event: every observer joins the room.
        for (const [name, socket] of Object.entries(sockets)) {
            try {
                await wsRequest(socket, 'joinChat', { chatId });
                check(`${name} joins the group room`, true);
            } catch (error) {
                check(`${name} joins the group room`, false, error.message);
            }
        }

        // ── per-row actions (the app renders exactly these flags) ──────────
        const ownerView = await members(chatId, TOKEN_OWNER);
        const ownerViewOf = (userId) =>
            ownerView.find((row) => Number(row.userId) === userId);
        check(
            'owner sees canBan on member and admin rows',
            ownerViewOf(memberId)?.actions?.canBan === true &&
                ownerViewOf(adminId)?.actions?.canBan === true,
            JSON.stringify(ownerViewOf(adminId)?.actions),
        );
        check(
            'owner does not see canBan on their own row',
            ownerViewOf(ownerId)?.actions?.canBan === false,
            JSON.stringify(ownerViewOf(ownerId)?.actions),
        );
        const adminView = await members(chatId, TOKEN_ADMIN);
        const adminViewOf = (userId) =>
            adminView.find((row) => Number(row.userId) === userId);
        check(
            'admin with ban_user sees canBan on member rows only',
            adminViewOf(memberId)?.actions?.canBan === true &&
                adminViewOf(outsiderId)?.actions?.canBan === true &&
                adminViewOf(adminId)?.actions?.canBan === false &&
                adminViewOf(ownerId)?.actions?.canBan === false,
        );

        // ── admin with ban_user bans a plain member ───────────────────────
        for (const value of Object.values(changes)) value.reset();
        for (const value of Object.values(removals)) value.reset();

        const adminBan = await ban(
            TOKEN_ADMIN,
            chatId,
            memberRow.memberId,
        );
        check(
            'admin with ban_user bans a member (role null, changed)',
            adminBan.status === 200 &&
                adminBan.body?.role === null &&
                adminBan.body?.changed === true,
            adminBan.text,
        );

        for (const name of ['owner', 'admin', 'outsider']) {
            try {
                await changes[name].wait(
                    (payload) =>
                        Number(payload.chatId) === chatId &&
                        payload.reason === 'member_banned' &&
                        Number(payload.userId) === memberId,
                );
                check(`${name} receives group:changed member_banned`, true);
            } catch {
                check(`${name} receives group:changed member_banned`, false);
            }
        }
        try {
            const removed = await removals.member.wait(
                (payload) =>
                    Number(payload.chatId) === chatId &&
                    payload.reason === 'banned',
            );
            check(
                'banned user receives group:removed reason banned',
                removed !== undefined,
            );
        } catch {
            check('banned user receives group:removed reason banned', false);
        }

        const afterBanRows = await members(chatId, TOKEN_OWNER);
        check(
            'banned member is gone from the members list',
            afterBanRows.every((row) => Number(row.userId) !== memberId),
        );
        const infoAfterBan = await api('GET', `/chats/${chatId}/group`, {
            token: TOKEN_OWNER,
        });
        check(
            'membersCount excludes the banned member',
            infoAfterBan.body?.membersCount === 3,
            infoAfterBan.text,
        );
        const bannedList = await banned(chatId, TOKEN_OWNER);
        const bannedMember = bannedList.find(
            (row) => Number(row.userId) === memberId,
        );
        check(
            'banned users list contains the member immediately',
            bannedMember !== undefined,
            JSON.stringify(bannedList),
        );

        const bannedGroup = await api('GET', `/chats/${chatId}/group`, {
            token: TOKEN_MEMBER,
        });
        check(
            'banned member cannot read the group (403)',
            bannedGroup.status === 403,
            `status ${bannedGroup.status}`,
        );
        const refusedSend = await wsSendExpectRefusal(sockets.member, {
            chatId,
            content: 'should not arrive',
            type: 'text',
        });
        check('banned member cannot send messages', refusedSend === true);
        const bannedChats =
            (await wsRequest(sockets.member, 'getAllChats')) ?? [];
        check(
            'banned member chat list no longer contains the group',
            bannedChats.every((row) => Number(row.id) !== chatId),
        );

        const link = await api('POST', `/chats/${chatId}/invite-links`, {
            token: TOKEN_OWNER,
            body: {},
        });
        const code = link.body?.code;
        check(
            'owner creates an invite link for the rejoin checks',
            link.status < 300 && typeof code === 'string',
            link.text,
        );
        const bannedJoin = await api('POST', `/invites/${code}/join`, {
            token: TOKEN_MEMBER,
        });
        check(
            'banned member cannot rejoin via the invite link (403/404)',
            bannedJoin.status === 403 || bannedJoin.status === 404,
            `status ${bannedJoin.status}`,
        );

        // ── unban ─────────────────────────────────────────────────────────
        const unban = await api(
            'POST',
            `/chats/manage/onban/${bannedMember?.memberId ?? memberRow.memberId}`,
            { token: TOKEN_OWNER },
        );
        check('owner unbans the member', unban.status === 200, unban.text);
        const afterUnbanRows = await members(chatId, TOKEN_OWNER);
        const rejoined = afterUnbanRows.find(
            (row) => Number(row.userId) === memberId,
        );
        check(
            'unbanned member is a plain member again',
            rejoined?.role === 'member',
            JSON.stringify(rejoined),
        );
        const unbannedGroup = await api('GET', `/chats/${chatId}/group`, {
            token: TOKEN_MEMBER,
        });
        check(
            'unbanned member can read the group again',
            unbannedGroup.status === 200,
            `status ${unbannedGroup.status}`,
        );
        const memberJoinAgain = await api('POST', `/invites/${code}/join`, {
            token: TOKEN_MEMBER,
        });
        check(
            'unbanned member is not rejected as banned on the invite link',
            memberJoinAgain.status !== 403,
            `status ${memberJoinAgain.status}`,
        );
        const removedMember = await api(
            'DELETE',
            `/chats/${chatId}/members/${rejoined?.memberId}`,
            { token: TOKEN_OWNER },
        );
        check(
            'owner removes the unbanned member before the join check',
            removedMember.status < 300,
            removedMember.text,
        );
        const trueJoin = await api('POST', `/invites/${code}/join`, {
            token: TOKEN_MEMBER,
        });
        check(
            'former banned member joins again through the invite link',
            trueJoin.status < 300 && trueJoin.body?.joined === true,
            trueJoin.text,
        );

        // ── admin without ban_user/all ────────────────────────────────────
        const reduced = await api(
            'PUT',
            `/chats/${chatId}/members/${adminRow.memberId}/permissions`,
            {
                token: TOKEN_OWNER,
                body: { permissions: ['delete_message'] },
            },
        );
        check(
            'owner removes ban_user from the admin',
            reduced.status === 200 && reduced.body?.changed === true,
            reduced.text,
        );
        const adminNoBan = await ban(
            TOKEN_ADMIN,
            chatId,
            outsiderRow.memberId,
        );
        check(
            'admin without ban_user/all is refused with 403',
            adminNoBan.status === 403,
            `status ${adminNoBan.status}`,
        );

        // ── admin cannot ban another admin or the owner ───────────────────
        const restored = await api(
            'PUT',
            `/chats/${chatId}/members/${adminRow.memberId}/permissions`,
            {
                token: TOKEN_OWNER,
                body: { permissions: ['ban_user'] },
            },
        );
        check(
            'owner gives ban_user back to the admin',
            restored.status === 200,
            restored.text,
        );
        const afterRejoinRows = await members(chatId, TOKEN_OWNER);
        const memberRow2 = afterRejoinRows.find(
            (row) => Number(row.userId) === memberId,
        );
        const promoted2 = await api(
            'POST',
            `/chats/${chatId}/members/${memberRow2?.memberId}/promote`,
            { token: TOKEN_OWNER },
        );
        check(
            'owner promotes the rejoined member to admin',
            promoted2.status < 300 && promoted2.body?.role === 'admin',
            promoted2.text,
        );
        const adminBanAdmin = await ban(
            TOKEN_ADMIN,
            chatId,
            memberRow2?.memberId,
        );
        check(
            'admin cannot ban another admin (403)',
            adminBanAdmin.status === 403,
            `status ${adminBanAdmin.status}`,
        );
        const adminBanOwner = await ban(
            TOKEN_ADMIN,
            chatId,
            ownerRow.memberId,
        );
        check(
            'admin cannot ban the owner (403)',
            adminBanOwner.status === 403,
            `status ${adminBanOwner.status}`,
        );
        const adminBanSelf = await ban(
            TOKEN_ADMIN,
            chatId,
            adminRow.memberId,
        );
        check(
            'nobody can ban themselves (admin self-ban 403)',
            adminBanSelf.status === 403,
            `status ${adminBanSelf.status}`,
        );
        const ownerBanSelf = await ban(
            TOKEN_OWNER,
            chatId,
            ownerRow.memberId,
        );
        check(
            'nobody can ban themselves (owner self-ban 403)',
            ownerBanSelf.status === 403,
            `status ${ownerBanSelf.status}`,
        );

        // ── owner bans a member and an admin ──────────────────────────────
        const ownerBanMember = await ban(
            TOKEN_OWNER,
            chatId,
            outsiderRow.memberId,
        );
        check(
            'owner bans a plain member',
            ownerBanMember.status === 200 &&
                ownerBanMember.body?.role === null,
            ownerBanMember.text,
        );
        const ownerBanAgain = await ban(
            TOKEN_OWNER,
            chatId,
            outsiderRow.memberId,
        );
        check(
            'banning an already banned user answers 409',
            ownerBanAgain.status === 409,
            `status ${ownerBanAgain.status}`,
        );
        const ownerBanAdmin = await ban(
            TOKEN_OWNER,
            chatId,
            memberRow2?.memberId,
        );
        check(
            'owner bans an admin',
            ownerBanAdmin.status === 200 &&
                ownerBanAdmin.body?.role === null,
            ownerBanAdmin.text,
        );

        const finalBanned = await banned(chatId, TOKEN_OWNER);
        const finalBannedIds = finalBanned.map((row) => Number(row.userId));
        check(
            'banned users list shows both banned members',
            finalBannedIds.includes(outsiderId) &&
                finalBannedIds.includes(memberId),
            JSON.stringify(finalBannedIds),
        );
        const finalMembers = await members(chatId, TOKEN_OWNER);
        check(
            'banned users are gone from the members list',
            finalMembers.every(
                (row) =>
                    Number(row.userId) !== outsiderId &&
                    Number(row.userId) !== memberId,
            ),
        );

        await sleep(300);
    } finally {
        for (const value of Object.values(changes)) value.close();
        for (const value of Object.values(removals)) value.close();
        for (const socket of Object.values(sockets)) socket.close();
    }

    if (failures > 0) {
        console.log(`\n${failures} check(s) failed`);
        process.exit(1);
    }
    console.log('\nAll ban checks passed');
    process.exit(0);
}

main().catch((error) => {
    console.error(`FAIL unexpected error — ${error.stack || error.message}`);
    process.exit(1);
});
