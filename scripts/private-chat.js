#!/usr/bin/env node
/**
 * Private (one-to-one) chat verification: HTTP + Socket.IO.
 *
 * Required env:
 *   URL, TOKEN_A, TOKEN_B, TOKEN_C
 *   USER_A_ID, USER_B_ID, USER_C_ID, USER_A_USERNAME, USER_B_USERNAME
 * Optional:
 *   INACTIVE_USER_ID   an existing user whose status is not `active`
 *   PRIVATE_MEMBER_ID  a `chat_members.id` of the A/B private chat (enables the
 *                      member-scoped admin-route assertion)
 *
 * Run against a fresh A/B pair for the "hidden before the first message"
 * assertions; a pre-existing conversation downgrades those to SKIP.
 * Exit code is non-zero as soon as any assertion fails.
 */
'use strict';

const { io } = require('socket.io-client');

const URL = required('URL').replace(/\/+$/, '');
const TOKEN_A = required('TOKEN_A');
const TOKEN_B = required('TOKEN_B');
const TOKEN_C = required('TOKEN_C');
const USER = {
    a: numberEnv('USER_A_ID'),
    b: numberEnv('USER_B_ID'),
};
const USERNAME_A = required('USER_A_USERNAME');
const USERNAME_B = required('USER_B_USERNAME');
const INACTIVE_USER_ID = optionalNumber('INACTIVE_USER_ID');
const PRIVATE_MEMBER_ID = optionalNumber('PRIVATE_MEMBER_ID');

let failures = 0;
const sockets = [];

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
    return Number.isInteger(value) && value > 0 ? value : null;
}

function numberEnv(name) {
    const value = Number(required(name));
    if (!Number.isInteger(value) || value <= 0) {
        console.error(`${name} must be a positive integer`);
        process.exit(1);
    }
    return value;
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

function skip(label, reason = '') {
    console.log(`SKIP ${label}${reason ? ` — ${reason}` : ''}`);
}

function check(condition, label, detail = '') {
    return condition ? pass(label, detail) : fail(label, detail);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function http(method, path, token, body, headers = {}) {
    const init = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body instanceof FormData) {
        init.body = body;
    } else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    Object.assign(init.headers, headers);
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
            reject(error);
        });
    });
}

function request(socket, event, payload) {
    return new Promise((resolve, reject) => {
        socket.timeout(10_000).emit(event, payload, (timeoutError, ack) => {
            if (timeoutError) {
                reject(new Error(`${event}: timeout`));
                return;
            }
            if (ack === undefined || ack === null) {
                reject(new Error(`${event}: no ack`));
                return;
            }
            if (ack.ok !== true) {
                reject(
                    Object.assign(new Error(`${event}: ${ack.message}`), {
                        status: ack.status,
                        ack,
                    }),
                );
                return;
            }
            resolve(ack.data);
        });
    });
}

async function expectRejected(socket, event, payload, label, expectedText) {
    try {
        await request(socket, event, payload);
        return fail(label, 'unexpectedly succeeded');
    } catch (error) {
        const message = String(error.message ?? error);
        if (expectedText !== undefined && !message.includes(expectedText)) {
            return fail(label, message);
        }
        return pass(label, message);
    }
}

function pngForm() {
    const bytes = Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
            '1f15c4890000000a49444154789c63600000020001e221bc3300000000' +
            '49454e44ae426082',
        'hex',
    );
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: 'image/png' }), 'pixel.png');
    return form;
}

async function main() {
    console.log(`Private chat verification against ${URL}`);

    const socketA = await connect(TOKEN_A);
    const socketB = await connect(TOKEN_B);
    const socketC = await connect(TOKEN_C);

    // ── 1. create / symmetric idempotency ────────────────────────────────
    const first = await http('POST', '/chats/private', TOKEN_A, {
        userId: USER.b,
    });
    check(first.status === 201 || first.status === 200, 'A creates a chat with B', `status ${first.status}`);
    const chatId = Number(first.data && first.data.chatId);
    check(Number.isInteger(chatId) && chatId > 0, 'create returns a numeric chatId', String(chatId));
    check(first.data && first.data.created === true, 'first creation reports created: true');
    check(
        first.data && first.data.peer && Number(first.data.peer.id) === USER.b,
        'peer is B',
    );
    const createWire = JSON.stringify(first.data ?? {});
    check(!createWire.includes('"phone"'), 'create payload contains no phone number');

    const again = await http('POST', '/chats/private', TOKEN_A, {
        userId: USER.b,
    });
    check(
        again.status < 300 && Number(again.data.chatId) === chatId && again.data.created === false,
        'A again → same chat, created: false',
    );
    const fromB = await http('POST', '/chats/private', TOKEN_B, {
        userId: USER.a,
    });
    check(
        fromB.status < 300 && Number(fromB.data.chatId) === chatId && fromB.data.created === false,
        'B with A → same chat, created: false',
    );

    // ── 2. concurrent creations, both directions ─────────────────────────
    const bursts = [];
    for (let index = 0; index < 20; index += 1) {
        bursts.push(http('POST', '/chats/private', TOKEN_A, { userId: USER.b }));
        bursts.push(http('POST', '/chats/private', TOKEN_B, { userId: USER.a }));
    }
    const burstResults = await Promise.all(bursts);
    const burstIds = new Set(
        burstResults.filter((row) => row.status < 300).map((row) => Number(row.data.chatId)),
    );
    check(
        burstResults.every((row) => row.status < 300) && burstIds.size === 1 && burstIds.has(chatId),
        '40 concurrent creations (both directions) resolve to ONE chat',
        `ids ${[...burstIds].join(',')}`,
    );
    const joinedA = await request(socketA, 'joinChat', { chatId });
    check(Number(joinedA.membersCount) === 2, 'private chat has exactly two members', String(joinedA.membersCount));

    // ── 3. validation ────────────────────────────────────────────────────
    const self = await http('POST', '/chats/private', TOKEN_A, { userId: USER.a });
    check(self.status === 400, 'self chat → 400', String(self.status));
    const missing = await http('POST', '/chats/private', TOKEN_A, { userId: 2147483000 });
    check(missing.status === 404, 'non-existent user → 404', String(missing.status));
    if (INACTIVE_USER_ID !== null) {
        const inactive = await http('POST', '/chats/private', TOKEN_A, { userId: INACTIVE_USER_ID });
        check(inactive.status === 404, 'inactive user → 404', String(inactive.status));
    } else {
        skip('inactive user → 404', 'INACTIVE_USER_ID not provided');
    }
    const badBody = await http('POST', '/chats/private', TOKEN_A, { userId: 'x' });
    check(badBody.status === 400, 'invalid body → 400', String(badBody.status));

    // ── 4. hidden before the first message ───────────────────────────────
    const chatsABefore = await request(socketA, 'getAllChats');
    const chatsBBefore = await request(socketB, 'getAllChats');
    if (first.data.created === true) {
        check(
            !chatsABefore.some((chat) => Number(chat.id) === chatId),
            'new empty chat is absent from A’s list',
        );
        check(
            !chatsBBefore.some((chat) => Number(chat.id) === chatId),
            'new empty chat is absent from B’s list',
        );
    } else {
        skip('empty chat hidden from both lists', 'chat already existed');
    }

    // ── 5. a non-member cannot join/read it ──────────────────────────────
    await expectRejected(socketC, 'joinChat', { chatId }, 'C cannot join the private chat');
    await expectRejected(socketC, 'getMessages', { chatId, limit: 10 }, 'C cannot read the private chat');

    // ── 6. first message → chatlist:updated + list rows ──────────────────
    const listUpdate = new Promise((resolve) => {
        const handler = (payload) => {
            if (Number(payload && payload.chatId) === chatId) {
                socketB.off('chatlist:updated', handler);
                resolve(payload);
            }
        };
        socketB.on('chatlist:updated', handler);
        setTimeout(() => {
            socketB.off('chatlist:updated', handler);
            resolve(null);
        }, 8000);
    });
    const firstMessage = await request(socketA, 'sendMessage', {
        chatId,
        content: `private smoke ${Date.now()}`,
        clientMessageId: `pv_${Date.now().toString(36)}`,
    });
    check(Number(firstMessage.chatId) === chatId, 'A sends the first message');
    const update = await listUpdate;
    check(update !== null, 'B receives chatlist:updated for the first message');

    const chatsA = await request(socketA, 'getAllChats');
    const chatsB = await request(socketB, 'getAllChats');
    const rowA = chatsA.find((chat) => Number(chat.id) === chatId);
    const rowB = chatsB.find((chat) => Number(chat.id) === chatId);
    check(rowA !== undefined && rowB !== undefined, 'chat appears in both lists');
    check(rowA && rowA.title === null && rowA.type === 'private', 'A row is private with title null');
    check(rowA && rowA.peer && Number(rowA.peer.id) === USER.b, 'A sees peer B');
    check(rowB && rowB.peer && Number(rowB.peer.id) === USER.a, 'B sees peer A');
    check(
        !JSON.stringify([rowA, rowB]).includes('"phone"'),
        'list rows never contain a phone number',
    );

    // ── 7. survives deleting its only message ────────────────────────────
    await request(socketA, 'deleteMessage', {
        chatId,
        messageId: Number(firstMessage.id),
    });
    await sleep(300);
    const chatsBAfterDelete = await request(socketB, 'getAllChats');
    check(
        chatsBAfterDelete.some((chat) => Number(chat.id) === chatId),
        'private chat stays listed after its only message is deleted',
    );

    // ── 8. group-only routes ─────────────────────────────────────────────
    const groupOnly = [
        ['POST', `/chats/manage/${chatId}/add/${encodeURIComponent('+10000000000')}`, undefined],
        ['POST', `/chats/manage/${chatId}/link`, { chatId }],
        ['PATCH', `/chats/manage/${chatId}/title`, { title: 'nope' }],
        ['GET', `/chats/manage/${chatId}/members`, undefined],
        ['GET', `/chats/manage/${chatId}/bans`, undefined],
        ['POST', `/chats/manage/${chatId}/leave`, undefined],
        ['POST', `/chats/manage/upload/avatar/${chatId}`, undefined],
        ['DELETE', `/chats/manage/delete/avatar/${chatId}`, { avatar: 'uploads/x.png' }],
    ];
    for (const [method, path, body] of groupOnly) {
        const response = await http(method, path, TOKEN_A, body);
        check(
            response.status === 400 &&
                JSON.stringify(response.data ?? {}).includes('only available in groups'),
            `group-only ${method} ${path.replace(String(chatId), ':chatId')} → 400`,
            String(response.status),
        );
    }
    if (PRIVATE_MEMBER_ID !== null) {
        const adminRoute = await http(
            'POST',
            `/chats/manage/admin/add/${PRIVATE_MEMBER_ID}`,
            TOKEN_A,
            { permissions: [] },
        );
        check(
            adminRoute.status === 400 &&
                JSON.stringify(adminRoute.data ?? {}).includes('only available in groups'),
            'group-only POST /admin/add/:memberId → 400',
            String(adminRoute.status),
        );
    } else {
        skip(
            'member-scoped admin route → 400',
            'PRIVATE_MEMBER_ID not provided (covered by the guard unit test)',
        );
    }
    const joinLink = await http('POST', `/chats/join/${'deadbeef'.repeat(4)}`, TOKEN_C);
    check(
        joinLink.status >= 400 && joinLink.status < 500,
        'invite join cannot open a chat with an unusable code',
        String(joinLink.status),
    );

    // ── 9. attachments / reply / forward / seen ──────────────────────────
    const upload = await http(
        'POST',
        `/chats/${chatId}/attachments`,
        TOKEN_A,
        pngForm(),
    );
    const attachment = upload.data && upload.data.data && upload.data.data[0];
    check(
        upload.status < 300 && attachment !== undefined && Number.isInteger(Number(attachment.id)),
        'attachment upload works in a private chat',
        String(upload.status),
    );
    const withFile = await request(socketA, 'sendMessage', {
        chatId,
        content: '',
        attachments: [Number(attachment.id)],
    });
    check(
        (withFile.attachments ?? []).length === 1,
        'attachment message is sent and echoed with metadata',
    );
    const base = await request(socketA, 'sendMessage', {
        chatId,
        content: 'reply target',
    });
    const reply = await request(socketA, 'sendMessage', {
        chatId,
        content: 'a reply',
        reply: Number(base.id),
    });
    check(Number(reply.replyToId) === Number(base.id), 'reply works in a private chat');
    const forward = await request(socketA, 'forwardMessages', {
        fromChatId: chatId,
        messageIds: [Number(base.id)],
        toChatIds: [chatId],
        requestId: `pv_fwd_${Date.now().toString(36)}`,
    });
    const forwardRow = ((forward && forward.results) ?? [])[0];
    check(forwardRow !== undefined && forwardRow.ok === true, 'forward works in a private chat');
    const seen = await request(socketB, 'markSeen', {
        chatId,
        lastSeenId: Math.max(
            Number(base.id),
            Number(reply.id),
            Number(withFile.id),
            Number(firstMessage.id),
        ),
    });
    check(Number.isInteger(Number(seen.lastSeenId)), 'seen works in a private chat');

    // ── 10. username search ──────────────────────────────────────────────
    const prefix = USERNAME_B.slice(0, 2);
    const upper = USERNAME_B.slice(0, 3).toUpperCase();
    const at = `@${prefix}`;
    const searchNormal = await http(
        'GET',
        `/user/search?q=${encodeURIComponent(prefix)}`,
        TOKEN_A,
    );
    const searchUpper = await http(
        'GET',
        `/user/search?q=${encodeURIComponent(upper)}`,
        TOKEN_A,
    );
    const searchAt = await http(
        'GET',
        `/user/search?q=${encodeURIComponent(at)}`,
        TOKEN_A,
    );
    const idsOf = (response) =>
        (response.data && response.data.data ? response.data.data : []).map((row) => Number(row.id));
    check(idsOf(searchNormal).includes(USER.b), 'search: username prefix finds B');
    check(idsOf(searchUpper).includes(USER.b), 'search: case-insensitive');
    check(idsOf(searchAt).includes(USER.b), 'search: leading @ is stripped');
    check(
        !JSON.stringify(searchNormal.data).includes('"phone"'),
        'search never returns a phone number',
    );
    check(
        !JSON.stringify(searchNormal.data).includes('"status"'),
        'search never returns account status',
    );
    const tooShort = await http('GET', '/user/search?q=a', TOKEN_A);
    check(tooShort.status === 400, 'search: query below 2 characters → 400', String(tooShort.status));
    const own = await http(
        'GET',
        `/user/search?q=${encodeURIComponent(USERNAME_A.slice(0, 3))}`,
        TOKEN_A,
    );
    check(!idsOf(own).includes(USER.a), 'search excludes the caller');
    const limited = await http('GET', '/user/search?q=a&limit=100', TOKEN_A).catch(() => null);
    if (limited !== null) {
        const rows = limited.data && limited.data.data ? limited.data.data : [];
        check(rows.length <= 20, 'search caps results at 20', String(rows.length));
    }
    const literalWildcard = await http(
        'GET',
        `/user/search?q=${encodeURIComponent('100%')}`,
        TOKEN_A,
    );
    check(
        literalWildcard.status === 200 || literalWildcard.status === 429,
        'search: LIKE wildcards are treated literally (no crash)',
        String(literalWildcard.status),
    );

    // Rate limit and recovery: burst with C, then wait for the next window.
    let saw429 = false;
    for (let index = 0; index < 32; index += 1) {
        const response = await http('GET', '/user/search?q=ab', TOKEN_C);
        if (response.status === 429) {
            saw429 = true;
            break;
        }
    }
    check(saw429, 'search: 429 beyond 30 requests/minute');
    if (saw429) {
        const waitMs = 62_000;
        console.log(`Waiting ${Math.round(waitMs / 1000)}s for the rate-limit window…`);
        await sleep(waitMs);
        const recovered = await http('GET', '/user/search?q=ab', TOKEN_C);
        check(recovered.status === 200, 'search recovers after the window', String(recovered.status));
    }

    // ── 11. chatInfo peer with presence ──────────────────────────────────
    const info = await request(socketA, 'joinChat', { chatId });
    check(
        info.peer !== undefined && info.peer !== null && Number(info.peer.id) === USER.b,
        'chatInfo carries peer B',
    );
    check(
        info.peer !== undefined &&
            info.peer !== null &&
            typeof info.peer.isOnline === 'boolean' &&
            Object.prototype.hasOwnProperty.call(info.peer, 'lastSeen'),
        'chatInfo peer has presence fields',
    );
    check(
        info.type === 'private' && info.title === null,
        'chatInfo is private with title null',
    );
    check(
        !JSON.stringify(info).includes('"phone"'),
        'chatInfo never contains a phone number',
    );
}

main()
    .catch((error) => {
        failures += 1;
        console.error(`FAIL unexpected error: ${error && error.stack ? error.stack : error}`);
    })
    .finally(() => {
        for (const socket of sockets) {
            socket.close();
        }
        console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
        process.exitCode = failures === 0 ? 0 : 1;
        setTimeout(() => process.exit(process.exitCode), 100);
    });
