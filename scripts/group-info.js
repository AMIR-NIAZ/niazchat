#!/usr/bin/env node
/*
 * End-to-end check for "Edit group info" (docs/mobile-api/groups.md).
 *
 * Env:
 *   URL              API origin (default http://localhost:3000)
 *   TOKEN_OWNER      owner token
 *   TOKEN_ADMIN      token of a user who will be promoted to admin
 *   TOKEN_MEMBER     token of a regular member
 *   TOKEN_OUTSIDER   token of a user who is NOT in the group
 *   TOKEN_ADMIN2     optional: extra member used for the banned-user checks
 *
 * The script creates its own group through the normal API, promotes the admin
 * through the panel endpoint, and prints PASS/FAIL lines. Exit code 1 on any
 * failure. No dependencies beyond the project's `socket.io-client`.
 */

/* eslint-disable no-console */
const { io } = require('socket.io-client');

const BASE = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_OWNER = process.env.TOKEN_OWNER;
const TOKEN_ADMIN = process.env.TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TOKEN_MEMBER;
const TOKEN_OUTSIDER = process.env.TOKEN_OUTSIDER;
const TOKEN_ADMIN2 = process.env.TOKEN_ADMIN2;

if (!TOKEN_OWNER || !TOKEN_ADMIN || !TOKEN_MEMBER || !TOKEN_OUTSIDER) {
    console.error(
        'Missing env: TOKEN_OWNER, TOKEN_ADMIN, TOKEN_MEMBER and TOKEN_OUTSIDER are required.',
    );
    process.exit(1);
}

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

let failures = 0;
let skips = 0;

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`PASS ${name}`);
    } else {
        failures += 1;
        console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function skip(name, why) {
    skips += 1;
    console.log(`SKIP ${name} — ${why}`);
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
    if (options.form !== undefined) {
        body = options.form;
    } else if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(options.body);
    }
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body,
        signal: options.signal,
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
        count: () => items.length,
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

function pngBlob() {
    return new Blob([TINY_PNG], { type: 'image/png' });
}

async function uploadAvatar(token, chatId, blob, fileName, signal) {
    const form = new FormData();
    form.append('avatar', blob, fileName);
    return api('POST', `/chats/${chatId}/group/avatar`, {
        token,
        form,
        signal,
    });
}

async function groupInfo(token, chatId) {
    return api('GET', `/chats/${chatId}/group`, { token });
}

async function main() {
    const ownerId = decodeUserId(TOKEN_OWNER);
    const adminId = decodeUserId(TOKEN_ADMIN);
    const memberId = decodeUserId(TOKEN_MEMBER);
    const outsiderId = decodeUserId(TOKEN_OUTSIDER);
    const admin2Id = TOKEN_ADMIN2 ? decodeUserId(TOKEN_ADMIN2) : null;

    console.log(`Group info E2E against ${BASE}`);

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
    for (const [name, socket] of Object.entries(sockets)) {
        changes[name] = collector(socket, 'group:changed');
    }

    const title = `Info ${String(Date.now()).slice(-8)}`;
    const members = [adminId, memberId, admin2Id]
        .filter((id) => id !== null && id !== undefined && id !== ownerId)
        .map(String);
    const created = await api('POST', '/chats/create', {
        token: TOKEN_OWNER,
        body: { title, members },
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

    const memberList = await api(
        'GET',
        `/chats/${chatId}/members?limit=100`,
        { token: TOKEN_OWNER },
    );
    const rows = memberList.body?.items ?? [];
    const adminRow = rows.find((row) => Number(row.userId) === adminId);
    const admin2Row = rows.find((row) => Number(row.userId) === admin2Id);
    check('admin is a member of the new group', adminRow !== undefined);

    const promoted = await api(
        'POST',
        `/chats/${chatId}/members/${adminRow?.memberId}/promote`,
        { token: TOKEN_OWNER },
    );
    check(
        'owner promotes admin (default permissions)',
        promoted.status < 300 && promoted.body?.role === 'admin',
        promoted.text,
    );

    // `group:changed` is a chat-room event: every observer must join the room.
    for (const [name, socket] of [
        ['owner', sockets.owner],
        ['admin', sockets.admin],
        ['member', sockets.member],
    ]) {
        try {
            await wsRequest(socket, 'joinChat', { chatId });
            check(`${name} joins the group room`, true);
        } catch (error) {
            check(`${name} joins the group room`, false, error.message);
        }
    }

    // ── capabilities ─────────────────────────────────────────────────────
    const ownerInfo = await groupInfo(TOKEN_OWNER, chatId);
    check(
        'owner capabilities.canEditInfo = true',
        ownerInfo.status === 200 &&
            ownerInfo.body?.capabilities?.canEditInfo === true,
        ownerInfo.text,
    );
    const adminInfo = await groupInfo(TOKEN_ADMIN, chatId);
    check(
        'promoted admin capabilities.canEditInfo = true',
        adminInfo.status === 200 &&
            adminInfo.body?.capabilities?.canEditInfo === true,
        adminInfo.text,
    );
    check(
        'admin myRole is admin (gear visibility field)',
        adminInfo.body?.myRole === 'admin',
        adminInfo.text,
    );
    const memberInfo = await groupInfo(TOKEN_MEMBER, chatId);
    check(
        'member capabilities.canEditInfo = false',
        memberInfo.status === 200 &&
            memberInfo.body?.capabilities?.canEditInfo === false,
        memberInfo.text,
    );
    const outsiderInfo = await groupInfo(TOKEN_OUTSIDER, chatId);
    check(
        'outsider GET group is refused',
        outsiderInfo.status === 403 || outsiderInfo.status === 404,
        `status ${outsiderInfo.status}`,
    );

    // ── concurrency + rate limit (fresh owner window) ────────────────────
    const concurrent = await Promise.all(
        Array.from({ length: 20 }, (_value, index) =>
            api('PATCH', `/chats/${chatId}/group`, {
                token: TOKEN_OWNER,
                body: { title: index % 2 === 0 ? 'Concurrent A' : 'Concurrent B' },
            }),
        ),
    );
    const statuses = concurrent.map((response) => response.status);
    check(
        '20 concurrent PATCH requests all commit',
        statuses.every((status) => status === 200),
        statuses.join(','),
    );
    const afterConcurrent = await groupInfo(TOKEN_OWNER, chatId);
    check(
        'concurrent PATCHes leave one consistent title',
        afterConcurrent.body?.title === 'Concurrent A' ||
            afterConcurrent.body?.title === 'Concurrent B',
        afterConcurrent.text,
    );
    check(
        'concurrent PATCHes never corrupt the description',
        afterConcurrent.body?.description === null,
        afterConcurrent.text,
    );

    const limited = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: 'Over limit' },
    });
    check(
        'rate limit triggers with 429',
        limited.status === 429,
        `status ${limited.status}`,
    );
    console.log('   waiting 61 s for the fixed rate-limit window to reset…');
    await sleep(61000);
    const recovered = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: 'Recovered title' },
    });
    check(
        'rate limit recovers after the window',
        recovered.status === 200,
        recovered.text,
    );

    // ── permission removal ───────────────────────────────────────────────
    const reduced = await api(
        'PUT',
        `/chats/${chatId}/members/${adminRow?.memberId}/permissions`,
        {
            token: TOKEN_OWNER,
            body: { permissions: ['ban_user', 'delete_message'] },
        },
    );
    check(
        'owner removes change_info_chat from the admin',
        reduced.status === 200 && reduced.body?.changed === true,
        reduced.text,
    );
    const adminAfter = await groupInfo(TOKEN_ADMIN, chatId);
    check(
        'admin capabilities.canEditInfo is now false',
        adminAfter.body?.capabilities?.canEditInfo === false,
        adminAfter.text,
    );
    check(
        'admin myRole is still admin',
        adminAfter.body?.myRole === 'admin',
        adminAfter.text,
    );
    const adminPatch = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_ADMIN,
        body: { title: 'Admin edit' },
    });
    check(
        'admin without change_info_chat is refused with 403',
        adminPatch.status === 403,
        `status ${adminPatch.status}`,
    );

    // ── owner text edit + realtime ───────────────────────────────────────
    for (const value of Object.values(changes)) value.reset();
    const edited = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: 'Renamed group', description: 'Group description' },
    });
    check(
        'owner PATCH title + description answers the new values',
        edited.status === 200 &&
            edited.body?.title === 'Renamed group' &&
            edited.body?.description === 'Group description' &&
            edited.body?.changed === true,
        edited.text,
    );
    const reasonMatches = (payload) =>
        Number(payload.chatId) === chatId && payload.reason === 'info_changed';
    for (const name of ['owner', 'admin', 'member']) {
        try {
            await changes[name].wait(reasonMatches);
            check(`${name} receives group:changed info_changed`, true);
        } catch {
            check(`${name} receives group:changed info_changed`, false);
        }
    }

    const listAfter = (await wsRequest(sockets.owner, 'getAllChats')) ?? [];
    const listRow = listAfter.find((row) => Number(row.id) === chatId);
    check(
        'getAllChats returns the new title and description',
        listRow?.title === 'Renamed group' &&
            listRow?.description === 'Group description',
        JSON.stringify(listRow),
    );
    const joined = await wsRequest(sockets.owner, 'joinChat', { chatId });
    check(
        'chatInfo returns the new title and description',
        joined?.title === 'Renamed group' &&
            joined?.description === 'Group description',
        JSON.stringify(joined),
    );

    // Idempotent identical PATCH: nothing emitted.
    for (const value of Object.values(changes)) value.reset();
    const identical = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: 'Renamed group', description: 'Group description' },
    });
    check(
        'identical PATCH answers changed:false',
        identical.status === 200 && identical.body?.changed === false,
        identical.text,
    );
    await sleep(600);
    check(
        'identical PATCH emits no group:changed',
        Object.values(changes).every((value) => value.count() === 0),
        Object.entries(changes)
            .map(([name, value]) => `${name}:${value.count()}`)
            .join(','),
    );

    // ── validation ───────────────────────────────────────────────────────
    const emptyTitle = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: '   ' },
    });
    check('empty title is rejected with 400', emptyTitle.status === 400, emptyTitle.text);
    const longTitle = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: 'x'.repeat(65) },
    });
    check('65-character title is rejected with 400', longTitle.status === 400, longTitle.text);
    const longDescription = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { description: 'x'.repeat(256) },
    });
    check(
        '256-character description is rejected with 400',
        longDescription.status === 400,
        longDescription.text,
    );
    const unknown = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: 'Unknown field', isBan: true },
    });
    check('unknown fields are rejected with 400', unknown.status === 400, unknown.text);
    const control = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { title: `Ctl${String.fromCharCode(0)}Name` },
    });
    check(
        'control characters are sanitized in the title',
        control.status === 200 &&
            typeof control.body?.title === 'string' &&
            !/[\u0000-\u001F\u007F-\u009F]/.test(control.body.title),
        control.text,
    );
    const cleared = await api('PATCH', `/chats/${chatId}/group`, {
        token: TOKEN_OWNER,
        body: { description: '   ' },
    });
    check(
        'blank description clears to null',
        cleared.status === 200 && cleared.body?.description === null,
        cleared.text,
    );

    // ── avatars ──────────────────────────────────────────────────────────
    const first = await uploadAvatar(
        TOKEN_OWNER,
        chatId,
        pngBlob(),
        'tiny.png',
    );
    check(
        'owner uploads a group photo',
        first.status < 300 &&
            first.body?.changed === true &&
            first.body?.avatars?.length === 1,
        first.text,
    );
    const firstPath = first.body?.avatars?.[0] ?? '';
    const firstFile = firstPath.split('/').pop();
    const firstThumb = `${BASE}/media/avatars/256/${encodeURIComponent(firstFile)}`;
    const thumbResponse = await fetch(firstThumb);
    check(
        'thumbnail endpoint serves the new group photo without auth',
        thumbResponse.status === 200 &&
            String(thumbResponse.headers.get('content-type') ?? '').includes(
                'image',
            ),
        `status ${thumbResponse.status}`,
    );
    const original = await fetch(`${BASE}/${firstPath}`);
    check(
        'original group photo is served publicly',
        original.status === 200,
        `status ${original.status}`,
    );

    const second = await uploadAvatar(
        TOKEN_OWNER,
        chatId,
        pngBlob(),
        'tiny2.png',
    );
    const secondPath = second.body?.avatars?.[0] ?? '';
    const secondFile = secondPath.split('/').pop();
    check(
        'uploading again ADDS a photo as current (gallery grows)',
        second.status < 300 &&
            secondPath !== '' &&
            secondPath !== firstPath &&
            second.body?.avatars?.length === 2 &&
            second.body.avatars[1] === firstPath,
        second.text,
    );
    check(
        'the previous photo is kept (original still reachable)',
        (await fetch(`${BASE}/${firstPath}`)).status === 200,
    );
    check(
        'the previous photo keeps its thumbnail',
        (await fetch(firstThumb)).status === 200,
    );
    const secondThumb = await fetch(
        `${BASE}/media/avatars/128/${encodeURIComponent(secondFile)}`,
    );
    check(
        'new thumbnail is generated',
        secondThumb.status === 200,
        `status ${secondThumb.status}`,
    );

    const removed = await api('DELETE', `/chats/${chatId}/group/avatar`, {
        token: TOKEN_OWNER,
    });
    check(
        'legacy delete removes ONLY the current photo',
        removed.status === 200 &&
            removed.body?.changed === true &&
            removed.body?.avatars?.length === 1 &&
            removed.body.avatars[0] === firstPath,
        removed.text,
    );
    check(
        'removed photo file is gone (404)',
        (await fetch(`${BASE}/${secondPath}`)).status === 404,
    );
    check(
        'the promoted next photo is still served',
        (await fetch(`${BASE}/${firstPath}`)).status === 200,
    );
    const removeLast = await api(
        'DELETE',
        `/chats/${chatId}/group/avatar`,
        { token: TOKEN_OWNER },
    );
    check(
        'legacy delete removes the last photo too',
        removeLast.status === 200 &&
            removeLast.body?.changed === true &&
            removeLast.body?.avatars?.length === 0,
        removeLast.text,
    );
    const removeAgain = await api(
        'DELETE',
        `/chats/${chatId}/group/avatar`,
        { token: TOKEN_OWNER },
    );
    check(
        'removing when there is no photo is idempotent',
        removeAgain.status === 200 && removeAgain.body?.changed === false,
        removeAgain.text,
    );

    const fake = await uploadAvatar(
        TOKEN_OWNER,
        chatId,
        new Blob([Buffer.from('not an image')], { type: 'image/png' }),
        'fake.png',
    );
    check(
        'text file renamed .png is rejected with 400',
        fake.status === 400,
        `status ${fake.status}`,
    );
    const afterFake = await groupInfo(TOKEN_OWNER, chatId);
    check(
        'rejected upload leaves the group photo unchanged',
        Array.isArray(afterFake.body?.avatars) &&
            afterFake.body.avatars.length === 0,
        afterFake.text,
    );

    const oversized = await uploadAvatar(
        TOKEN_OWNER,
        chatId,
        new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: 'image/png' }),
        'huge.png',
    );
    check(
        'oversized image is rejected with 413',
        oversized.status === 413,
        `status ${oversized.status}`,
    );

    const beforeAbort = await groupInfo(TOKEN_OWNER, chatId);
    const controller = new AbortController();
    const aborted = uploadAvatar(
        TOKEN_OWNER,
        chatId,
        new Blob([Buffer.alloc(5 * 1024 * 1024)], { type: 'image/png' }),
        'aborted.png',
        controller.signal,
    ).catch(() => null);
    setTimeout(() => controller.abort(), 10);
    await aborted;
    await sleep(800);
    const afterAbort = await groupInfo(TOKEN_OWNER, chatId);
    check(
        'aborted upload leaves the group photo unchanged',
        JSON.stringify(beforeAbort.body?.avatars ?? []) ===
            JSON.stringify(afterAbort.body?.avatars ?? []),
        afterAbort.text,
    );

    // ── refusals ─────────────────────────────────────────────────────────
    for (const [name, token] of [
        ['member', TOKEN_MEMBER],
        ['outsider', TOKEN_OUTSIDER],
    ]) {
        const patch = await api('PATCH', `/chats/${chatId}/group`, {
            token,
            body: { title: `${name} edit` },
        });
        check(
            `${name} PATCH is refused`,
            patch.status === 403 || patch.status === 404,
            `status ${patch.status}`,
        );
        const upload = await uploadAvatar(token, chatId, pngBlob(), 'm.png');
        check(
            `${name} avatar upload is refused`,
            upload.status === 403 || upload.status === 404,
            `status ${upload.status}`,
        );
        const clear = await api('DELETE', `/chats/${chatId}/group/avatar`, {
            token,
        });
        check(
            `${name} avatar delete is refused`,
            clear.status === 403 || clear.status === 404,
            `status ${clear.status}`,
        );
    }

    if (TOKEN_ADMIN2 && admin2Row) {
        const banned = await api(
            'POST',
            `/chats/manage/ban/${admin2Row.memberId}`,
            { token: TOKEN_OWNER },
        );
        check('owner bans the extra member', banned.status < 300, banned.text);
        const patch = await api('PATCH', `/chats/${chatId}/group`, {
            token: TOKEN_ADMIN2,
            body: { title: 'Banned edit' },
        });
        check(
            'banned user PATCH is refused',
            patch.status === 403 || patch.status === 404,
            `status ${patch.status}`,
        );
        const upload = await uploadAvatar(
            TOKEN_ADMIN2,
            chatId,
            pngBlob(),
            'banned.png',
        );
        check(
            'banned user avatar upload is refused',
            upload.status === 403 || upload.status === 404,
            `status ${upload.status}`,
        );
        const clear = await api('DELETE', `/chats/${chatId}/group/avatar`, {
            token: TOKEN_ADMIN2,
        });
        check(
            'banned user avatar delete is refused',
            clear.status === 403 || clear.status === 404,
            `status ${clear.status}`,
        );
    } else {
        skip(
            'banned user is refused on every endpoint',
            'TOKEN_ADMIN2 not provided',
        );
    }

    const privateChat = await api('POST', '/chats/private', {
        token: TOKEN_OWNER,
        body: { userId: memberId },
    });
    const privateId =
        privateChat.body?.id ??
        privateChat.body?.chatId ??
        privateChat.body?.chat?.id;
    check(
        'private chat is created for the type check',
        privateChat.status < 300 && privateId !== undefined,
        privateChat.text,
    );
    if (privateId !== undefined) {
        const patch = await api('PATCH', `/chats/${privateId}/group`, {
            token: TOKEN_OWNER,
            body: { title: 'Private' },
        });
        check(
            'private chat PATCH answers 400',
            patch.status === 400,
            `status ${patch.status}`,
        );
        const upload = await uploadAvatar(
            TOKEN_OWNER,
            privateId,
            pngBlob(),
            'private.png',
        );
        check(
            'private chat avatar upload answers 400',
            upload.status === 400,
            `status ${upload.status}`,
        );
        const clear = await api(
            'DELETE',
            `/chats/${privateId}/group/avatar`,
            { token: TOKEN_OWNER },
        );
        check(
            'private chat avatar delete answers 400',
            clear.status === 400,
            `status ${clear.status}`,
        );
    }

    for (const value of Object.values(changes)) value.close();
    for (const socket of Object.values(sockets)) socket.close();

    console.log(
        `\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failure(s), ${skips} skipped.`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(`FAIL uncaught: ${error.stack || error.message}`);
    process.exit(1);
});
