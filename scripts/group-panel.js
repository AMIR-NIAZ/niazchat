#!/usr/bin/env node
/**
 * Group info panel end-to-end check (HTTP + Socket.IO).
 *
 * Required env:
 *   URL, TOKEN_OWNER, TOKEN_ADMIN, TOKEN_MEMBER, TOKEN_OUTSIDER
 *
 * The script creates its own group through the normal API, so it works
 * without the owner backfill. The other three accounts are added by phone
 * (their own `GET /auth/getme` supplies it — no extra env needed). Every
 * assertion prints PASS/FAIL; any failure exits non-zero.
 *
 * Optional:
 *   RATE_LIMIT_WAIT_MS  recovery wait after the 429 check (default 61000)
 */
'use strict';

const { io } = require('socket.io-client');

const URL = required('URL').replace(/\/+$/, '');
const TOKEN = {
    owner: required('TOKEN_OWNER'),
    admin: required('TOKEN_ADMIN'),
    member: required('TOKEN_MEMBER'),
    outsider: required('TOKEN_OUTSIDER'),
};
const RATE_WAIT_MS = optionalNumber('RATE_LIMIT_WAIT_MS') ?? 61_000;

let failures = 0;
const sockets = [];
const cleanup = [];

function required(name) {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        console.error(`Missing required env var ${name}`);
        process.exit(1);
    }
    return value.trim();
}

function optionalNumber(name) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function pass(label, detail = '') {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
    return true;
}

function fail(label, detail = '') {
    failures += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    return false;
}

function check(condition, label, detail = '') {
    return condition ? pass(label, detail) : fail(label, detail);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPhoneKey(value, seen = new Set()) {
    if (value === null || typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        if (key.toLowerCase().includes('phone')) return true;
        if (hasPhoneKey(child, seen)) return true;
    }
    return false;
}

async function http(method, path, token, body) {
    const init = {
        method,
        headers: { Authorization: `Bearer ${token}` },
    };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const response = await fetch(`${URL}${path}`, init);
    const text = await response.text();
    let data = null;
    try {
        data = text === '' ? null : JSON.parse(text);
    } catch {
        data = text;
    }
    return { status: response.status, data };
}

function connect(token) {
    return new Promise((resolve, reject) => {
        const socket = io(URL, {
            transports: ['websocket'],
            reconnection: false,
            extraHeaders: { authorization: `Bearer ${token}` },
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('socket connect timeout'));
        }, 10_000);
        socket.once('connect', () => {
            clearTimeout(timer);
            sockets.push(socket);
            resolve(socket);
        });
        socket.once('connect_error', (error) => {
            clearTimeout(timer);
            socket.close();
            reject(new Error(`socket connect failed: ${error.message}`));
        });
    });
}

function request(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${event} ack timeout`)),
            10_000,
        );
        socket.emit(event, payload, (ack) => {
            clearTimeout(timer);
            if (ack === undefined || ack === null) {
                reject(new Error(`${event} returned no ack`));
                return;
            }
            if (ack.ok !== true) {
                reject(new Error(`${event} failed: ${ack.message ?? 'error'}`));
                return;
            }
            resolve(ack.data ?? null);
        });
    });
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 8_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`timeout waiting for ${event}`));
        }, timeoutMs);
        function handler(payload) {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        }
        socket.on(event, handler);
        cleanup.push(() => {
            clearTimeout(timer);
            socket.off(event, handler);
        });
    });
}

function startListening(socket, event, collector) {
    const handler = (payload) => collector.push(payload);
    socket.on(event, handler);
    cleanup.push(() => socket.off(event, handler));
}

async function getMe(token) {
    const response = await http('GET', '/auth/getme', token);
    if (response.status !== 200 || response.data === null) {
        throw new Error(`getme failed with ${response.status}`);
    }
    return response.data;
}

async function allChats(socket) {
    return (await request(socket, 'getAllChats')) ?? [];
}

async function addMemberByPhone(ownerToken, chatId, phone) {
    return http(
        'POST',
        `/chats/manage/${chatId}/add/${encodeURIComponent(phone)}`,
        ownerToken,
    );
}

async function memberIdOf(chatId, token, userId) {
    const response = await http(
        'GET',
        `/chats/${chatId}/members?limit=100`,
        token,
    );
    if (response.status !== 200) {
        throw new Error(`members list failed with ${response.status}`);
    }
    const item = (response.data.items ?? []).find(
        (row) => Number(row.userId) === Number(userId),
    );
    if (item === undefined) {
        throw new Error(`user ${userId} is not in the members list`);
    }
    return Number(item.memberId);
}

async function main() {
    const me = {
        owner: await getMe(TOKEN.owner),
        admin: await getMe(TOKEN.admin),
        member: await getMe(TOKEN.member),
        outsider: await getMe(TOKEN.outsider),
    };
    const userId = (key) => Number(me[key].id);
    const phone = (key) => String(me[key].phone);

    const socket = {
        owner: await connect(TOKEN.owner),
        admin: await connect(TOKEN.admin),
        member: await connect(TOKEN.member),
        outsider: await connect(TOKEN.outsider),
    };

    const title = `GroupPanel ${Date.now()}`;
    const created = await http('POST', '/chats/create', TOKEN.owner, { title });
    check(created.status === 201 || created.status === 200, 'creates a test group');

    const ownerChats = await allChats(socket.owner);
    const group = ownerChats.find(
        (chat) => chat.title === title && chat.type === 'groupe',
    );
    if (group === undefined) {
        fail('finds the created group in getAllChats');
        return;
    }
    const chatId = Number(group.id);
    pass('finds the created group in getAllChats', `chatId=${chatId}`);

    check(
        (await addMemberByPhone(TOKEN.owner, chatId, phone('admin'))).status < 300,
        'adds the admin account',
    );
    check(
        (await addMemberByPhone(TOKEN.owner, chatId, phone('member'))).status < 300,
        'adds the member account',
    );

    await request(socket.owner, 'joinChat', { chatId });
    await request(socket.admin, 'joinChat', { chatId });
    await request(socket.member, 'joinChat', { chatId });

    // ── group info & member list (member perspective) ─────────────────────
    const info = await http('GET', `/chats/${chatId}/group`, TOKEN.member);
    check(info.status === 200, 'member opens group info');
    check(
        info.data?.myRole === 'member',
        'group info reports myRole=member',
        String(info.data?.myRole),
    );
    check(
        Number(info.data?.owner?.userId) === userId('owner'),
        'group info reports the creator as owner',
    );
    check(
        Number(info.data?.membersCount) === 3,
        'group info counts 3 non-banned members',
        String(info.data?.membersCount),
    );
    check(
        Array.isArray(info.data?.avatars) && !hasPhoneKey(info.data),
        'group info has avatars and no phone',
    );

    const pageOne = await http(
        'GET',
        `/chats/${chatId}/members?limit=2`,
        TOKEN.member,
    );
    check(pageOne.status === 200, 'member opens members list');
    check(
        (pageOne.data?.items ?? []).length === 2 &&
            typeof pageOne.data?.nextCursor === 'string',
        'first members page has 2 items and a cursor',
    );
    check(
        pageOne.data?.items?.[0]?.role === 'owner' &&
            pageOne.data?.items?.[1]?.role === 'admin',
        'members order owner then admin',
    );
    check(!hasPhoneKey(pageOne.data), 'members list has no phone anywhere');

    const pageTwo = await http(
        'GET',
        `/chats/${chatId}/members?limit=2&cursor=${encodeURIComponent(
            pageOne.data?.nextCursor ?? '',
        )}`,
        TOKEN.member,
    );
    check(
        pageTwo.status === 200 &&
            (pageTwo.data?.items ?? []).length === 1 &&
            pageTwo.data?.items?.[0]?.role === 'member',
        'second members page has the regular member (no gap/duplicate)',
    );

    const searchTerm = me.member.username || me.member.name;
    const searched = await http(
        'GET',
        `/chats/${chatId}/members?search=${encodeURIComponent(searchTerm)}`,
        TOKEN.member,
    );
    check(
        searched.status === 200 &&
            (searched.data?.items ?? []).some(
                (row) => Number(row.userId) === userId('member'),
            ),
        'search finds the member',
    );

    const outsiderInfo = await http(
        'GET',
        `/chats/${chatId}/group`,
        TOKEN.outsider,
    );
    const outsiderList = await http(
        'GET',
        `/chats/${chatId}/members`,
        TOKEN.outsider,
    );
    check(
        (outsiderInfo.status === 403 || outsiderInfo.status === 404) &&
            (outsiderList.status === 403 || outsiderList.status === 404),
        'outsider is rejected on both read endpoints',
        `${outsiderInfo.status}/${outsiderList.status}`,
    );

    // ── promote / demote ───────────────────────────────────────────────────
    const adminMemberId = await memberIdOf(chatId, TOKEN.owner, userId('admin'));
    const memberMemberId = await memberIdOf(
        chatId,
        TOKEN.owner,
        userId('member'),
    );

    const changedEvents = [];
    startListening(socket.owner, 'group:changed', changedEvents);

    const promote = await http(
        'POST',
        `/chats/${chatId}/members/${memberMemberId}/promote`,
        TOKEN.owner,
    );
    check(
        promote.status === 201 || promote.status === 200,
        'owner promotes the member',
    );
    check(
        promote.data?.role === 'admin' && promote.data?.changed === true,
        'promote ack is { role: admin, changed: true }',
    );
    const changed = await waitFor(
        socket.owner,
        'group:changed',
        (event) =>
            Number(event.chatId) === chatId &&
            event.reason === 'role_changed' &&
            Number(event.userId) === userId('member'),
    ).catch(() => null);
    check(
        changed !== null,
        'room receives group:changed role_changed for the promoted user',
        changedEvents.length > 0 ? `${changedEvents.length} event(s)` : '',
    );

    const adminPerms = await http(
        'GET',
        `/chats/manage/admin/permissions/${memberMemberId}`,
        TOKEN.owner,
    );
    const granted = adminPerms.data?.granted ?? [];
    check(
        ['ban_user', 'delete_message', 'change_info_chat'].every((name) =>
            granted.includes(name),
        ),
        'promoted admin receives the default permissions',
        JSON.stringify(granted),
    );

    const promoteAgain = await http(
        'POST',
        `/chats/${chatId}/members/${memberMemberId}/promote`,
        TOKEN.owner,
    );
    check(
        promoteAgain.data?.changed === false,
        'promoting the same admin again is changed: false',
    );

    // ── admin removal rights ───────────────────────────────────────────────
    check(
        (await addMemberByPhone(TOKEN.owner, chatId, phone('outsider'))).status <
            300,
        'adds the outsider as a regular member for removal tests',
    );
    const outsiderMemberId = await memberIdOf(
        chatId,
        TOKEN.owner,
        userId('outsider'),
    );

    const removeBan = await http(
        'DELETE',
        `/chats/manage/admin/permissions/${memberMemberId}`,
        TOKEN.owner,
        { permissions: ['ban_user'] },
    );
    check(removeBan.status < 300, 'owner revokes ban_user from the admin');
    const adminWithoutBan = await http(
        'DELETE',
        `/chats/${chatId}/members/${outsiderMemberId}`,
        TOKEN.admin,
    );
    check(
        adminWithoutBan.status === 403,
        'admin without ban_user cannot remove a member',
        String(adminWithoutBan.status),
    );
    check(
        (await http(
            'POST',
            `/chats/manage/admin/permissions/${memberMemberId}`,
            TOKEN.owner,
            { permissions: ['ban_user'] },
        )).status < 300,
        'owner grants ban_user back',
    );

    const outsiderRemoved = [];
    startListening(socket.outsider, 'group:removed', outsiderRemoved);
    const adminRemove = await http(
        'DELETE',
        `/chats/${chatId}/members/${outsiderMemberId}`,
        TOKEN.admin,
    );
    check(
        (adminRemove.status === 200 || adminRemove.status === 201) &&
            adminRemove.data?.role === null,
        'admin with ban_user removes the regular member',
    );
    const removedEvent = await waitFor(
        socket.outsider,
        'group:removed',
        (event) =>
            Number(event.chatId) === chatId && event.reason === 'kicked',
    ).catch(() => null);
    check(
        removedEvent !== null && outsiderRemoved.length > 0,
        'removed user receives group:removed kicked',
    );

    const outsiderChats = await allChats(socket.outsider);
    check(
        !outsiderChats.some((chat) => Number(chat.id) === chatId),
        'removed user no longer sees the group in getAllChats',
    );
    const rejoin = await request(socket.outsider, 'joinChat', { chatId }).then(
        () => null,
        (error) => error,
    );
    check(rejoin !== null, 'removed user cannot joinChat');
    const messagesAfterRemoval = await request(socket.outsider, 'getMessages', {
        chatId,
    }).then(
        () => null,
        (error) => error,
    );
    check(messagesAfterRemoval !== null, 'removed user cannot getMessages');

    check(
        (await addMemberByPhone(TOKEN.owner, chatId, phone('outsider'))).status <
            300,
        'removed member can be added again (not a ban)',
    );
    await request(socket.outsider, 'joinChat', { chatId }).catch(() => undefined);

    // ── admin cannot outrank admins or the owner ───────────────────────────
    const promoteOutsider = await http(
        'POST',
        `/chats/${chatId}/members/${await memberIdOf(
            chatId,
            TOKEN.owner,
            userId('outsider'),
        )}/promote`,
        TOKEN.owner,
    );
    check(promoteOutsider.data?.changed === true, 'owner promotes a second admin');

    const secondAdminMemberId = await memberIdOf(
        chatId,
        TOKEN.owner,
        userId('outsider'),
    );
    for (const [label, path] of [
        ['promote another admin', 'promote'],
        ['demote another admin', 'demote'],
        ['remove another admin', 'remove'],
    ]) {
        const response =
            path === 'remove'
                ? await http(
                      'DELETE',
                      `/chats/${chatId}/members/${secondAdminMemberId}`,
                      TOKEN.admin,
                  )
                : await http(
                      'POST',
                      `/chats/${chatId}/members/${secondAdminMemberId}/${path}`,
                      TOKEN.admin,
                  );
        check(
            response.status === 403,
            `admin cannot ${label}`,
            String(response.status),
        );
    }
    const removeOwner = await http(
        'DELETE',
        `/chats/${chatId}/members/${await memberIdOf(
            chatId,
            TOKEN.owner,
            userId('owner'),
        )}`,
        TOKEN.admin,
    );
    check(removeOwner.status === 403, 'admin cannot remove the owner', String(removeOwner.status));
    const removeSelf = await http(
        'DELETE',
        `/chats/${chatId}/members/${adminMemberId}`,
        TOKEN.admin,
    );
    check(removeSelf.status === 403, 'nobody can remove themselves', String(removeSelf.status));

    // ── demote removes permissions ─────────────────────────────────────────
    const demoteSecond = await http(
        'POST',
        `/chats/${chatId}/members/${secondAdminMemberId}/demote`,
        TOKEN.owner,
    );
    check(
        demoteSecond.data?.role === 'member' && demoteSecond.data?.changed === true,
        'owner demotes the second admin',
    );
    const afterDemote = await http(
        'GET',
        `/chats/manage/admin/permissions/${secondAdminMemberId}`,
        TOKEN.owner,
    );
    check(
        (afterDemote.data?.granted ?? []).length === 0,
        'demoted admin has no permission rows left',
    );

    // ── owner removal + messages do not reach the removed user ─────────────
    startListening(socket.outsider, 'sendMessage:list', outsiderRemoved);
    outsiderRemoved.length = 0;
    const ownerRemove = await http(
        'DELETE',
        `/chats/${chatId}/members/${secondAdminMemberId}`,
        TOKEN.owner,
    );
    check(
        (ownerRemove.status === 200 || ownerRemove.status === 201) &&
            ownerRemove.data?.role === null,
        'owner removes a member',
    );
    await waitFor(
        socket.outsider,
        'group:removed',
        (event) => Number(event.chatId) === chatId,
    ).catch(() => null);
    await request(socket.owner, 'sendMessage', {
        chatId,
        content: 'after removal',
    }).catch(() => undefined);
    await sleep(800);
    check(
        outsiderRemoved.every((event) => Number(event.chatId) !== chatId),
        'messages sent after removal do not reach the removed user',
    );
    check(
        (await addMemberByPhone(TOKEN.owner, chatId, phone('outsider'))).status <
            300,
        'owner can add the removed user back',
    );

    // ── concurrent actions on one target stay consistent ───────────────────
    const concurrencyTarget = await memberIdOf(
        chatId,
        TOKEN.owner,
        userId('outsider'),
    );
    const concurrent = await Promise.all(
        Array.from({ length: 20 }, () =>
            http(
                'POST',
                `/chats/${chatId}/members/${concurrencyTarget}/promote`,
                TOKEN.owner,
            ),
        ),
    );
    const statuses = concurrent.map((response) => response.status);
    check(
        statuses.every((status) => status === 200 || status === 201 || status === 409),
        '20 concurrent promotes answer 2xx/409 (never 500)',
        statuses.join(','),
    );
    const afterConcurrent = await http(
        'GET',
        `/chats/${chatId}/members?search=${encodeURIComponent(
            me.outsider.username || me.outsider.name,
        )}`,
        TOKEN.owner,
    );
    check(
        afterConcurrent.data?.items?.[0]?.role === 'admin',
        'concurrent promotes leave the target consistently admin',
    );

    // ── cross-chat targets ─────────────────────────────────────────────────
    const otherTitle = `GroupPanelOther ${Date.now()}`;
    await http('POST', '/chats/create', TOKEN.owner, {
        title: otherTitle,
        members: [String(userId('outsider'))],
    });
    const other = (await allChats(socket.owner)).find(
        (chat) => chat.title === otherTitle,
    );
    if (other !== undefined) {
        const foreignMemberId = await memberIdOf(
            Number(other.id),
            TOKEN.owner,
            userId('outsider'),
        );
        const crossChat = await http(
            'DELETE',
            `/chats/${chatId}/members/${foreignMemberId}`,
            TOKEN.owner,
        );
        check(
            crossChat.status === 404,
            'a member id from another chat is rejected with 404',
            String(crossChat.status),
        );
    } else {
        fail('creates the second group for the cross-chat check');
    }

    // ── private chat answers 400 on every endpoint ─────────────────────────
    const privateChat = await http('POST', '/chats/private', TOKEN.outsider, {
        userId: userId('owner'),
    });
    const privateId = Number(
        privateChat.data?.chatId ?? privateChat.data?.id ?? 0,
    );
    if (privateId > 0) {
        const attempts = [
            await http('GET', `/chats/${privateId}/group`, TOKEN.outsider),
            await http('GET', `/chats/${privateId}/members`, TOKEN.outsider),
            await http(
                'POST',
                `/chats/${privateId}/members/1/promote`,
                TOKEN.outsider,
            ),
            await http(
                'POST',
                `/chats/${privateId}/members/1/demote`,
                TOKEN.outsider,
            ),
            await http(
                'DELETE',
                `/chats/${privateId}/members/1`,
                TOKEN.outsider,
            ),
        ];
        check(
            attempts.every((response) => response.status === 400),
            'private chat answers 400 on all five endpoints',
            attempts.map((response) => response.status).join(','),
        );
    } else {
        fail('creates a private chat for the 400 checks');
    }

    // ── rate limit triggers and recovers ───────────────────────────────────
    const rateTarget = await memberIdOf(chatId, TOKEN.owner, userId('admin'));
    let saw429 = false;
    for (let index = 0; index < 35 && !saw429; index += 1) {
        const response = await http(
            'POST',
            `/chats/${chatId}/members/${rateTarget}/promote`,
            TOKEN.admin,
        );
        if (response.status === 429) saw429 = true;
    }
    check(saw429, 'per-user rate limit returns 429 after 30 actions');
    if (saw429) {
        console.log(`INFO waiting ${RATE_WAIT_MS} ms for the rate window…`);
        await sleep(RATE_WAIT_MS);
        const recovered = await http(
            'POST',
            `/chats/${chatId}/members/${rateTarget}/promote`,
            TOKEN.admin,
        );
        check(
            recovered.status !== 429,
            'rate limit recovers after the window',
            String(recovered.status),
        );
    }
}

(async () => {
    try {
        await main();
    } catch (error) {
        fail('unexpected error', error instanceof Error ? error.message : String(error));
    } finally {
        for (const stop of cleanup) stop();
        for (const socket of sockets) socket.close();
    }
    if (failures > 0) {
        console.error(`\n${failures} assertion(s) failed`);
        process.exit(1);
    }
    console.log('\nAll group panel assertions passed');
    process.exit(0);
})();
