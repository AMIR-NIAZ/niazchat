#!/usr/bin/env node
/*
 * End-to-end check for GROUP PROFILE PHOTOS (docs/mobile-api/groups.md).
 *
 * Env:
 *   URL              API origin (default http://localhost:3000)
 *   TOKEN_OWNER      token of the group owner (creates the test groups)
 *   TOKEN_ADMIN      token of a user promoted to admin in the main group
 *   TOKEN_MEMBER     token of a regular member
 *   TOKEN_OUTSIDER   token of a user who is NOT in the main group
 *   UPLOADS_DIR      optional: backend uploads/avatars directory, enables
 *                    "no file left behind" checks
 *
 * The script creates its own groups through the normal API, promotes the admin
 * through the panel endpoint and generates tiny PNGs itself. PASS/FAIL output,
 * exit code 1 on any failure. Uses the project's socket.io-client only.
 *
 * Rate limits are per user (20 avatar operations/minute), so the heavy phases
 * (10-photo limit, concurrency) run on OTHER tokens/groups and the rate-limit
 * phase runs last.
 */

/* eslint-disable no-console */
const { readdir } = require('node:fs/promises');
const { join } = require('node:path');
const { io } = require('socket.io-client');

const BASE = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_OWNER = process.env.TOKEN_OWNER;
const TOKEN_ADMIN = process.env.TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TOKEN_MEMBER;
const TOKEN_OUTSIDER = process.env.TOKEN_OUTSIDER;
const MAX_PHOTOS = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const UPLOADS_DIR =
    process.env.UPLOADS_DIR || join(process.cwd(), 'uploads', 'avatars');

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

function basename(storedPath) {
    return (storedPath || '').split('/').pop() || '';
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

function pngBlob(buffer = TINY_PNG) {
    return new Blob([buffer], { type: 'image/png' });
}

async function uploadPhoto(token, chatId, options = {}) {
    const form = new FormData();
    form.append(
        'avatar',
        options.blob ?? pngBlob(),
        options.fileName ?? 'photo.png',
    );
    return api('POST', options.path ?? `/chats/${chatId}/group/avatars`, {
        token,
        form,
        signal: options.signal,
    });
}

async function groupInfo(token, chatId) {
    return api('GET', `/chats/${chatId}/group`, { token });
}

async function listChats(socket) {
    return (await wsRequest(socket, 'getAllChats')) ?? [];
}

async function createGroup(token, title, memberIds) {
    const created = await api('POST', '/chats/create', {
        token,
        body: { title, members: memberIds.map(String) },
    });
    if (created.status >= 300) {
        throw new Error(`create group failed: ${created.text}`);
    }
    return created;
}

async function findChat(socket, title) {
    const chats = await listChats(socket);
    const chat = chats.find(
        (row) => row.title === title && row.type === 'groupe',
    );
    return chat === undefined ? null : Number(chat.id);
}

async function promote(socket, chatId, userId) {
    const members = await api('GET', `/chats/${chatId}/members?limit=100`, {
        token: TOKEN_OWNER,
    });
    const row = (members.body?.items ?? []).find(
        (item) => Number(item.userId) === userId,
    );
    if (row === undefined) throw new Error('admin is not a member');
    const result = await api(
        'POST',
        `/chats/${chatId}/members/${row.memberId}/promote`,
        { token: TOKEN_OWNER },
    );
    if (result.status >= 300) {
        throw new Error(`promote failed: ${result.text}`);
    }
}

async function memberRow(token, chatId, userId) {
    const members = await api('GET', `/chats/${chatId}/members?limit=100`, {
        token,
    });
    return (members.body?.items ?? []).find(
        (item) => Number(item.userId) === userId,
    );
}

async function deleteAllPhotos(token, chatId) {
    for (let attempt = 0; attempt < MAX_PHOTOS + 4; attempt += 1) {
        const info = await groupInfo(token, chatId);
        const avatars = info.body?.avatars ?? [];
        if (avatars.length === 0) return;
        const response = await api(
            'DELETE',
            `/chats/${chatId}/group/avatars/${encodeURIComponent(basename(avatars[0]))}`,
            { token },
        );
        if (response.status >= 300) {
            throw new Error(`reset failed: ${response.text}`);
        }
    }
    throw new Error('could not reset group photos');
}

async function avatarFileSet() {
    try {
        return new Set(await readdir(UPLOADS_DIR));
    } catch {
        return null;
    }
}

function sameSet(a, b) {
    if (a === null || b === null) return true;
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
}

async function fetchStatus(url) {
    try {
        const response = await fetch(url);
        return response.status;
    } catch {
        return 0;
    }
}

async function main() {
    const ownerId = decodeUserId(TOKEN_OWNER);
    const adminId = decodeUserId(TOKEN_ADMIN);
    const memberId = decodeUserId(TOKEN_MEMBER);
    const outsiderId = decodeUserId(TOKEN_OUTSIDER);

    console.log(`Group photo E2E against ${BASE}`);

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

    const stamp = String(Date.now()).slice(-8);
    const title = `Photos ${stamp}`;
    await createGroup(TOKEN_OWNER, title, [adminId, memberId]);
    const chatId = await findChat(sockets.owner, title);
    if (chatId === null) {
        console.error('FAIL group created but not found in getAllChats');
        process.exit(1);
    }
    await promote(sockets.owner, chatId, adminId);

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

    // ── owner uploads three photos ───────────────────────────────────────
    const uploaded = [];
    for (const label of ['one', 'two', 'three']) {
        const response = await uploadPhoto(TOKEN_OWNER, chatId, {
            fileName: `${label}.png`,
        });
        check(
            `owner upload ${label} accepted (201)`,
            response.status === 201,
            response.text,
        );
        uploaded.push(response.body);
    }

    const third = uploaded[2]?.avatars ?? [];
    const names = third.map(basename);
    check(
        'three photos stored, newest first',
        third.length === 3 &&
            uploaded[1]?.avatars?.length === 2 &&
            uploaded[0]?.avatars?.length === 1,
        JSON.stringify(uploaded.map((body) => body?.avatars)),
    );
    check(
        'stored photo names are unique and server-generated',
        new Set(names).size === 3 &&
            !names.some((name) => /^(one|two|three)\.png$/.test(name)),
        names.join(','),
    );

    const newestThree = names[0];
    const middleThree = names[1];
    const oldestThree = names[2];
    for (const size of [64, 128, 256]) {
        const status = await fetchStatus(
            `${BASE}/media/avatars/${size}/${encodeURIComponent(newestThree)}`,
        );
        check(`thumbnail ${size} is public`, status === 200, `status ${status}`);
    }
    check(
        'original photo is publicly reachable',
        (await fetchStatus(
            `${BASE}/uploads/avatars/${encodeURIComponent(newestThree)}`,
        )) === 200,
    );

    // ── admin with default change_info_chat ──────────────────────────────
    const adminUpload = await uploadPhoto(TOKEN_ADMIN, chatId, {
        fileName: 'admin.png',
    });
    check(
        'admin with change_info_chat uploads',
        adminUpload.status === 201 &&
            (adminUpload.body?.avatars?.length ?? 0) === 4,
        adminUpload.text,
    );
    const adminName = basename(adminUpload.body?.avatars?.[0] ?? '');
    const adminDelete = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(adminName)}`,
        { token: TOKEN_ADMIN },
    );
    check(
        'admin deletes one photo by file name',
        adminDelete.status === 200 &&
            (adminDelete.body?.avatars?.length ?? 0) === 3,
        adminDelete.text,
    );

    // ── member sees all photos, cannot change them ───────────────────────
    const memberInfo = await groupInfo(TOKEN_MEMBER, chatId);
    check(
        'member sees the whole photo set',
        memberInfo.status === 200 &&
            (memberInfo.body?.avatars?.length ?? 0) === 3,
        memberInfo.text,
    );
    const memberUpload = await uploadPhoto(TOKEN_MEMBER, chatId);
    const memberDelete = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(newestThree)}`,
        { token: TOKEN_MEMBER },
    );
    const memberPromote = await api(
        'PUT',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(newestThree)}/main`,
        { token: TOKEN_MEMBER },
    );
    check(
        'member is refused on upload/delete/promote (403)',
        memberUpload.status === 403 &&
            memberDelete.status === 403 &&
            memberPromote.status === 403,
        `upload=${memberUpload.status} delete=${memberDelete.status} promote=${memberPromote.status}`,
    );

    // ── outsider ─────────────────────────────────────────────────────────
    const outsiderInfo = await groupInfo(TOKEN_OUTSIDER, chatId);
    const outsiderUpload = await uploadPhoto(TOKEN_OUTSIDER, chatId);
    const outsiderDelete = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(newestThree)}`,
        { token: TOKEN_OUTSIDER },
    );
    check(
        'outsider is refused everywhere',
        outsiderInfo.status === 403 &&
            outsiderUpload.status === 403 &&
            outsiderDelete.status === 403,
        `info=${outsiderInfo.status} upload=${outsiderUpload.status} delete=${outsiderDelete.status}`,
    );

    // ── admin without the permission ─────────────────────────────────────
    const adminRow = await memberRow(TOKEN_OWNER, chatId, adminId);
    await api(
        'PUT',
        `/chats/${chatId}/members/${adminRow?.memberId}/permissions`,
        { token: TOKEN_OWNER, body: { permissions: [] } },
    );
    const deniedUpload = await uploadPhoto(TOKEN_ADMIN, chatId);
    check(
        'admin without change_info_chat gets 403 on upload',
        deniedUpload.status === 403,
        `status ${deniedUpload.status}`,
    );

    // ── fresh three photos for the ordering rules ────────────────────────
    await deleteAllPhotos(TOKEN_OWNER, chatId);
    const fresh = [];
    for (const label of ['a', 'b', 'c']) {
        fresh.push(
            await uploadPhoto(TOKEN_OWNER, chatId, {
                fileName: `${label}.png`,
            }),
        );
    }
    const freshNames = (fresh[2]?.body?.avatars ?? []).map(basename);
    const [currentName, secondName, thirdName] = freshNames;

    const promoted = await api(
        'PUT',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(thirdName)}/main`,
        { token: TOKEN_OWNER },
    );
    const promotedNames = (promoted.body?.avatars ?? []).map(basename);
    check(
        'promote moves the third photo to current, others keep order',
        promoted.status === 200 &&
            promotedNames.join(',') ===
                [thirdName, currentName, secondName].join(','),
        promoted.text,
    );
    const promotedAgain = await api(
        'PUT',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(thirdName)}/main`,
        { token: TOKEN_OWNER },
    );
    check(
        'promoting the current photo answers changed:false',
        promotedAgain.status === 200 &&
            promotedAgain.body?.changed === false,
        promotedAgain.text,
    );

    const deleteCurrent = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(thirdName)}`,
        { token: TOKEN_OWNER },
    );
    const afterDeleteCurrent = (deleteCurrent.body?.avatars ?? []).map(
        basename,
    );
    check(
        'deleting the current photo promotes the next',
        deleteCurrent.status === 200 &&
            afterDeleteCurrent.join(',') ===
                [currentName, secondName].join(','),
        deleteCurrent.text,
    );
    check(
        'deleted photo file 404s',
        (await fetchStatus(
            `${BASE}/uploads/avatars/${encodeURIComponent(thirdName)}`,
        )) === 404,
    );
    for (const size of [64, 128, 256]) {
        check(
            `deleted photo thumbnail ${size} 404s`,
            (await fetchStatus(
                `${BASE}/media/avatars/${size}/${encodeURIComponent(thirdName)}`,
            )) === 404,
        );
    }

    const deleteNonCurrent = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(secondName)}`,
        { token: TOKEN_OWNER },
    );
    check(
        'deleting a non-current photo keeps the current one',
        deleteNonCurrent.status === 200 &&
            (deleteNonCurrent.body?.avatars ?? []).map(basename).join(',') ===
                currentName,
        deleteNonCurrent.text,
    );

    const deleteLast = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(currentName)}`,
        { token: TOKEN_OWNER },
    );
    check(
        'deleting the last photo leaves an empty array',
        deleteLast.status === 200 &&
            (deleteLast.body?.avatars ?? []).length === 0,
        deleteLast.text,
    );

    // ── invalid names ────────────────────────────────────────────────────
    const unknown = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/definitely-not-here.png`,
        { token: TOKEN_OWNER },
    );
    check('unknown file name answers 404', unknown.status === 404, unknown.text);

    const traversal = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent('../../etc/passwd')}`,
        { token: TOKEN_OWNER },
    );
    check(
        'path-shaped file name is rejected with 4xx',
        traversal.status >= 400 && traversal.status < 500,
        `status ${traversal.status}`,
    );

    // ── legacy aliases ───────────────────────────────────────────────────
    const legacyUpload = await uploadPhoto(TOKEN_OWNER, chatId, {
        path: `/chats/${chatId}/group/avatar`,
        fileName: 'legacy.png',
    });
    check(
        'legacy POST /group/avatar behaves as add',
        legacyUpload.status === 201 &&
            (legacyUpload.body?.avatars?.length ?? 0) === 1,
        legacyUpload.text,
    );
    const legacyName = basename(legacyUpload.body?.avatars?.[0] ?? '');
    const legacyDelete = await api(
        'DELETE',
        `/chats/${chatId}/group/avatar`,
        { token: TOKEN_OWNER },
    );
    check(
        'legacy DELETE /group/avatar removes only the current photo',
        legacyDelete.status === 200 &&
            (legacyDelete.body?.avatars ?? []).length === 0,
        legacyDelete.text,
    );
    check(
        'legacy-deleted file 404s',
        (await fetchStatus(
            `${BASE}/uploads/avatars/${encodeURIComponent(legacyName)}`,
        )) === 404,
    );
    const legacyAgain = await api(
        'DELETE',
        `/chats/${chatId}/group/avatar`,
        { token: TOKEN_OWNER },
    );
    check(
        'legacy delete on an empty set is idempotent',
        legacyAgain.status === 200 && legacyAgain.body?.changed === false,
        legacyAgain.text,
    );

    // ── rejected uploads leave nothing behind ────────────────────────────
    const beforeRejected = await avatarFileSet();
    const textUpload = await uploadPhoto(TOKEN_OWNER, chatId, {
        blob: new Blob([Buffer.from('renamed text, not an image')], {
            type: 'image/png',
        }),
        fileName: 'fake.png',
    });
    check(
        'text file renamed .png is rejected (400)',
        textUpload.status === 400,
        `status ${textUpload.status}`,
    );
    const oversized = await uploadPhoto(TOKEN_OWNER, chatId, {
        blob: new Blob([Buffer.alloc(MAX_BYTES + 1024)], { type: 'image/png' }),
        fileName: 'huge.png',
    });
    check(
        'oversized image is rejected (413)',
        oversized.status === 413,
        `status ${oversized.status}`,
    );

    const controller = new AbortController();
    const aborted = uploadPhoto(TOKEN_OWNER, chatId, {
        blob: new Blob([Buffer.alloc(MAX_BYTES)], { type: 'image/png' }),
        fileName: 'aborted.png',
        signal: controller.signal,
    }).catch(() => null);
    setTimeout(() => controller.abort(), 10);
    await aborted;
    await sleep(800);
    const infoAfterRejected = await groupInfo(TOKEN_OWNER, chatId);
    check(
        'rejected/aborted uploads change no photo',
        (infoAfterRejected.body?.avatars ?? []).length === 0,
        infoAfterRejected.text,
    );
    if (beforeRejected !== null) {
        check(
            'rejected/aborted uploads leave no file on disk',
            sameSet(beforeRejected, await avatarFileSet()),
        );
    }

    // ── ten-photo limit (admin on a separate group) ───────────────────────
    const limitTitle = `Limit ${stamp}`;
    await createGroup(TOKEN_OWNER, limitTitle, [adminId]);
    const limitChatId = await findChat(sockets.owner, limitTitle);
    await promote(sockets.owner, limitChatId, adminId);
    const limitNames = [];
    for (let index = 0; index < MAX_PHOTOS; index += 1) {
        const response = await uploadPhoto(TOKEN_ADMIN, limitChatId, {
            fileName: `fill-${index}.png`,
        });
        if (response.status !== 201) {
            check(`fill photo ${index + 1}/10`, false, response.text);
            break;
        }
        limitNames.push(basename(response.body.avatars[0]));
    }
    check(
        'group can hold 10 photos',
        limitNames.length === MAX_PHOTOS &&
            new Set(limitNames).size === MAX_PHOTOS,
        `count=${limitNames.length}`,
    );

    const filesBeforeEleventh = await avatarFileSet();
    const eleventh = await uploadPhoto(TOKEN_ADMIN, limitChatId, {
        fileName: 'eleventh.png',
    });
    const limitMessage =
        typeof eleventh.body?.message === 'string'
            ? eleventh.body.message
            : '';
    check(
        '11th upload is rejected with a clear limit message',
        eleventh.status === 400 &&
            limitMessage.toLowerCase().includes('limit') &&
            limitMessage.includes(String(MAX_PHOTOS)),
        `status ${eleventh.status} message=${limitMessage}`,
    );
    const afterEleventh = await groupInfo(TOKEN_OWNER, limitChatId);
    check(
        '11th upload did not change the array',
        (afterEleventh.body?.avatars ?? []).length === MAX_PHOTOS,
        afterEleventh.text,
    );
    check(
        '11th upload leaves no file behind',
        sameSet(filesBeforeEleventh, await avatarFileSet()),
    );
    const otherChatName = limitNames[0];
    const foreign = await api(
        'DELETE',
        `/chats/${chatId}/group/avatars/${encodeURIComponent(otherChatName)}`,
        { token: TOKEN_OWNER },
    );
    check(
        "another chat's photo name is rejected",
        foreign.status === 404,
        `status ${foreign.status}`,
    );

    // ── 5 concurrent uploads at 6/10 ─────────────────────────────────────
    const concurrencyTitle = `Race ${stamp}`;
    await createGroup(TOKEN_OUTSIDER, concurrencyTitle, []);
    const raceChatId = await findChat(sockets.outsider, concurrencyTitle);
    const seeded = [];
    for (let index = 0; index < 6; index += 1) {
        const response = await uploadPhoto(TOKEN_OUTSIDER, raceChatId, {
            fileName: `seed-${index}.png`,
        });
        if (response.status === 201) {
            seeded.push(basename(response.body.avatars[0]));
        }
    }
    const parallel = await Promise.all(
        Array.from({ length: 5 }, (_value, index) =>
            uploadPhoto(TOKEN_OUTSIDER, raceChatId, {
                fileName: `race-${index}.png`,
            }),
        ),
    );
    const succeeded = parallel.filter(
        (response) => response.status === 201,
    ).length;
    const limited = parallel.filter(
        (response) => response.status === 400,
    ).length;
    const raceInfo = await groupInfo(TOKEN_OUTSIDER, raceChatId);
    const raceNames = (raceInfo.body?.avatars ?? []).map(basename);
    check(
        '5 concurrent uploads at 6/10: exactly 4 succeed, 1 is refused',
        succeeded === 4 && limited === 1,
        `ok=${succeeded} limited=${limited}`,
    );
    check(
        'concurrent uploads never exceed 10 and never lose a photo',
        raceNames.length === MAX_PHOTOS &&
            new Set(raceNames).size === MAX_PHOTOS &&
            seeded.every((name) => raceNames.includes(name)),
        `count=${raceNames.length} seededKept=${seeded.filter((name) => raceNames.includes(name)).length}`,
    );

    // ── private chat answers 400 on every photo endpoint ─────────────────
    const privateChat = await api('POST', '/chats/private', {
        token: TOKEN_OWNER,
        body: { userId: memberId },
    });
    const privateId =
        privateChat.body?.id ??
        privateChat.body?.chatId ??
        privateChat.body?.chat?.id;
    if (privateId !== undefined) {
        const privateUpload = await uploadPhoto(TOKEN_OWNER, privateId);
        const privateDelete = await api(
            'DELETE',
            `/chats/${privateId}/group/avatars/x.png`,
            { token: TOKEN_OWNER },
        );
        const privatePromote = await api(
            'PUT',
            `/chats/${privateId}/group/avatars/x.png/main`,
            { token: TOKEN_OWNER },
        );
        const privateLegacy = await api(
            'DELETE',
            `/chats/${privateId}/group/avatar`,
            { token: TOKEN_OWNER },
        );
        check(
            'private chat answers 400 on every photo endpoint',
            [privateUpload, privateDelete, privatePromote, privateLegacy].every(
                (response) => response.status === 400,
            ),
            [
                privateUpload.status,
                privateDelete.status,
                privatePromote.status,
                privateLegacy.status,
            ].join(','),
        );
    } else {
        check('private chat could be created for the type check', false, privateChat.text);
    }

    // ── realtime + chat-list/current-photo projection ────────────────────
    for (const value of Object.values(changes)) value.reset();
    const realtimeUpload = await uploadPhoto(TOKEN_OWNER, chatId, {
        fileName: 'realtime.png',
    });
    const realtimeName = basename(realtimeUpload.body?.avatars?.[0] ?? '');
    const realtimeCheck = (payload) =>
        Number(payload.chatId) === chatId &&
        payload.reason === 'avatars_changed' &&
        Number(payload.userId) === ownerId;
    for (const name of ['owner', 'admin', 'member']) {
        try {
            await changes[name].wait(realtimeCheck);
            check(`${name} receives group:changed avatars_changed`, true);
        } catch {
            check(`${name} receives group:changed avatars_changed`, false);
        }
    }
    const listAfter = await listChats(sockets.owner);
    const listRow = listAfter.find((row) => Number(row.id) === chatId);
    check(
        'getAllChats exposes ONLY the current photo',
        Array.isArray(listRow?.avatars) &&
            listRow.avatars.length === 1 &&
            basename(listRow.avatars[0]) === realtimeName,
        JSON.stringify(listRow?.avatars),
    );
    const joined = await wsRequest(sockets.owner, 'joinChat', { chatId });
    check(
        'chatInfo exposes ONLY the current photo',
        Array.isArray(joined?.avatars) &&
            joined.avatars.length === 1 &&
            basename(joined.avatars[0]) === realtimeName,
        JSON.stringify(joined?.avatars),
    );
    const fullInfo = await groupInfo(TOKEN_MEMBER, chatId);
    check(
        'GET group still exposes the full gallery',
        (fullInfo.body?.avatars ?? []).length === 1,
        fullInfo.text,
    );

    // ── rate limit (owner, last so earlier phases are not affected) ──────
    let hitLimit = false;
    for (let attempt = 0; attempt < 14 && !hitLimit; attempt += 1) {
        const response = await uploadPhoto(TOKEN_OWNER, chatId, {
            fileName: `limit-${attempt}.png`,
        });
        if (response.status === 429) hitLimit = true;
        else if (response.status !== 201) {
            check(
                'rate-limit phase uploads keep working until the limit',
                false,
                `${response.status} ${response.text}`,
            );
            break;
        }
    }
    check('photo rate limit triggers with 429', hitLimit);
    if (hitLimit) {
        console.log('   waiting 62 s for the fixed rate-limit window…');
        await sleep(62000);
        const recovered = await uploadPhoto(TOKEN_OWNER, chatId, {
            fileName: 'recovered.png',
        });
        check(
            'photo rate limit recovers after the window',
            recovered.status === 201,
            recovered.text,
        );
    } else {
        check('photo rate limit recovers after the window', false, 'limit never triggered');
    }

    // Leave the test groups clean (best effort; owner limit may still apply).
    await deleteAllPhotos(TOKEN_OWNER, chatId).catch(() => undefined);

    for (const value of Object.values(changes)) value.close();
    for (const socket of Object.values(sockets)) socket.close();

    console.log(
        `\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failure(s).`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(`FAIL uncaught: ${error.stack || error.message}`);
    process.exit(1);
});
