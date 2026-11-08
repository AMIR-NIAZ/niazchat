#!/usr/bin/env node
/**
 * Avatar thumbnail + message-sender check against a running backend.
 *
 *   URL=http://localhost:3000 TOKEN=<access token> node scripts/avatar-thumbs.js
 *
 * Optional:
 *   CHAT_ID=<id>          assert `getMessages` sender fields in that chat
 *   SEND_TEST_MESSAGE=1   also send one text message and check its
 *                         `sendMessage:list` echo (adds a real message)
 *
 * Exit code is non-zero when any assertion fails.
 */

const sharp = require('sharp');
const { io } = require('socket.io-client');

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN ?? '';
const CHAT_ID = process.env.CHAT_ID ? Number(process.env.CHAT_ID) : null;
const SEND_TEST_MESSAGE = process.env.SEND_TEST_MESSAGE === '1';

if (BASE === '' || TOKEN === '') {
    console.error('URL and TOKEN env vars are required.');
    process.exit(2);
}

let failures = 0;

function pass(label, detail) {
    console.log(`PASS  ${label}${detail ? `  (${detail})` : ''}`);
}

function fail(label, detail) {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
}

function assert(label, condition, detail) {
    if (condition) pass(label, detail);
    else fail(label, detail);
    return condition;
}

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

async function http(path, init = {}) {
    return fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...authHeaders, ...(init.headers ?? {}) },
    });
}

async function main() {
    // A real PNG (not a fake) so the server's byte sniffing accepts it.
    const png = await sharp({
        create: {
            width: 400,
            height: 300,
            channels: 3,
            background: { r: 33, g: 150, b: 243 },
        },
    })
        .png()
        .toBuffer();

    const form = new FormData();
    form.append('avatar', new Blob([png], { type: 'image/png' }), 'check.png');
    const upload = await http('/user/avatars', { method: 'POST', body: form });
    const uploaded = await upload.json().catch(() => null);
    const storedPath = uploaded?.user?.avatars?.[0];
    if (!assert('avatar upload returns the stored path', typeof storedPath === 'string', String(storedPath))) {
        console.error(JSON.stringify(uploaded));
        process.exit(1);
    }
    const fileName = storedPath.split('/').pop();

    const originalResponse = await fetch(
        `${BASE}/uploads/avatars/${encodeURIComponent(fileName)}`,
    );
    const originalBytes = Buffer.from(await originalResponse.arrayBuffer());
    assert(
        'originals are long-cacheable too',
        (originalResponse.headers.get('cache-control') ?? '').includes('immutable'),
        originalResponse.headers.get('cache-control') ?? 'none',
    );

    // ── first thumbnail (64) ───────────────────────────────────────────────
    const thumb = await http(`/media/avatars/64/${encodeURIComponent(fileName)}`);
    const thumbBytes = Buffer.from(await thumb.arrayBuffer());
    const thumbMeta = await sharp(thumbBytes).metadata();
    assert('thumbnail responds 200', thumb.status === 200, String(thumb.status));
    assert(
        'thumbnail content type is an image',
        (thumb.headers.get('content-type') ?? '').startsWith('image/'),
        thumb.headers.get('content-type') ?? 'none',
    );
    assert(
        'thumbnail is 64x64',
        thumbMeta.width === 64 && thumbMeta.height === 64,
        `${thumbMeta.width}x${thumbMeta.height}`,
    );
    const cacheControl = thumb.headers.get('cache-control') ?? '';
    assert(
        'thumbnail cache-control is immutable + 1 year',
        cacheControl.includes('immutable') && cacheControl.includes('max-age=31536000'),
        cacheControl,
    );
    const etag = thumb.headers.get('etag');
    assert('thumbnail has an ETag', typeof etag === 'string' && etag.length > 0, String(etag));
    console.log(
        `      sizes: original ${originalBytes.length} B, thumb 64 ${thumbBytes.length} B`,
    );
    assert(
        'thumbnail is much smaller than the original',
        thumbBytes.length < originalBytes.length,
        `${thumbBytes.length} < ${originalBytes.length}`,
    );

    const conditional = await http(`/media/avatars/64/${encodeURIComponent(fileName)}`, {
        headers: { 'If-None-Match': etag ?? '' },
    });
    assert('If-None-Match returns 304', conditional.status === 304, String(conditional.status));

    // ── validation ─────────────────────────────────────────────────────────
    const badSize = await http(`/media/avatars/32/${encodeURIComponent(fileName)}`);
    assert('disallowed size returns 400', badSize.status === 400, String(badSize.status));

    const traversal = await http('/media/avatars/64/..%2Favatars%2Fx.png');
    assert(
        'path traversal is rejected',
        traversal.status === 400 || traversal.status === 404,
        String(traversal.status),
    );

    const unknown = await http(`/media/avatars/64/${Date.now()}-missing.png`);
    assert('unknown file returns 404', unknown.status === 404, String(unknown.status));

    // ── concurrency: one generation per (size, file) ───────────────────────
    const concurrent = await Promise.all(
        Array.from({ length: 20 }, () =>
            http(`/media/avatars/128/${encodeURIComponent(fileName)}`),
        ),
    );
    const bodies = await Promise.all(
        concurrent.map(async (response) => Buffer.from(await response.arrayBuffer())),
    );
    const generated = concurrent.filter(
        (response) => response.headers.get('x-avatar-thumbnail') === 'generated',
    );
    assert('20 concurrent requests generate once', generated.length === 1, `${generated.length} generated`);
    assert(
        'concurrent responses are identical bytes',
        new Set(bodies.map((body) => body.toString('base64'))).size === 1,
        `${new Set(bodies.map((body) => body.toString('base64'))).size} distinct`,
    );

    // ── message payload privacy (WS) ───────────────────────────────────────
    await checkMessagePayloads();

    // ── deletion removes originals and thumbnails ──────────────────────────
    const remove = await http(`/user/avatars/${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
    });
    assert('avatar delete succeeds', remove.status === 200, String(remove.status));

    for (const size of [64, 128]) {
        const after = await http(`/media/avatars/${size}/${encodeURIComponent(fileName)}`);
        assert(
            `deleting the avatar removes its ${size}px thumbnail`,
            after.status === 404,
            String(after.status),
        );
    }

    if (failures > 0) {
        console.error(`\n${failures} avatar thumbnail check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll avatar thumbnail checks passed.');
}

function checkSenderShape(label, sender) {
    if (sender === null || sender === undefined) {
        return fail(`${label}: sender present`);
    }
    const keys = Object.keys(sender).sort();
    assert(
        `${label}: sender has only id/name/username/avatars`,
        JSON.stringify(keys) === JSON.stringify(['avatars', 'id', 'name', 'username']),
        keys.join(','),
    );
    assert(
        `${label}: current avatar only`,
        Array.isArray(sender.avatars) && sender.avatars.length <= 1,
        Array.isArray(sender.avatars) ? `${sender.avatars.length} photo(s)` : 'not an array',
    );
    pass(`${label}: sender id/name present`, `id=${sender.id} name=${sender.name}`);
}

async function checkMessagePayloads() {
    if (CHAT_ID === null) {
        console.log('SKIP  message payload check (set CHAT_ID to run it)');
        return;
    }
    const socket = io(BASE, {
        extraHeaders: authHeaders,
        auth: { token: TOKEN },
        transports: ['websocket'],
        reconnection: false,
    });

    const connected = await new Promise((resolve) => {
        socket.once('connect', () => resolve(true));
        socket.once('connect_error', () => resolve(false));
        setTimeout(() => resolve(false), 5000);
    });
    if (!connected) {
        fail('message payload check: socket connects');
        socket.close();
        return;
    }

    const history = await new Promise((resolve) => {
        socket.emit('getMessages', { chatId: CHAT_ID, limit: 5 }, (ack) => resolve(ack));
        setTimeout(() => resolve(null), 5000);
    });
    const messages = history?.data?.messages ?? history?.messages ?? [];
    if (messages.length === 0) {
        console.log('SKIP  message payload check (chat has no messages)');
    } else {
        checkSenderShape('getMessages', messages[0].sender);
        assert(
            'getMessages: top-level senderId still present',
            typeof messages[0].senderId === 'number',
            String(messages[0].senderId),
        );
    }

    if (SEND_TEST_MESSAGE) {
        const echo = await new Promise((resolve) => {
            socket.once('sendMessage:list', (payload) => resolve(payload));
            socket.emit('sendMessage', {
                chatId: CHAT_ID,
                content: `avatar-check ${new Date().toISOString()}`,
                type: 'text',
            });
            setTimeout(() => resolve(null), 6000);
        });
        if (echo === null) {
            fail('sendMessage:list echo received');
        } else {
            checkSenderShape('sendMessage:list', echo.sender);
        }
    } else {
        console.log('SKIP  sendMessage:list check (set SEND_TEST_MESSAGE=1 to run it)');
    }

    socket.close();
}

main().catch((error) => {
    console.error('check crashed:', error);
    process.exit(1);
});
