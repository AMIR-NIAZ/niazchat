#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * End-to-end attachment check (HTTP upload/download/preview + WebSocket send).
 *
 * Required env:
 *   URL            http(s) origin of the API (no trailing slash)
 *   TOKEN_A        access token of the uploader/sender
 *   TOKEN_B        access token of another member of CHAT_ID
 *   TOKEN_OUTSIDER access token of a NON-member (for 404/403 checks)
 *   CHAT_ID        chat where A and B are members
 *
 * Optional:
 *   CHAT_ID_2      a second chat (A is a member) for the wrong-chat claim test
 *   ORPHAN_WAIT_MS if set, wait this long and assert an unattached upload was
 *                  cleaned up. Start the backend with a short
 *                  ATTACHMENT_ORPHAN_TTL_MS and ATTACHMENT_CLEANUP_INTERVAL_MS.
 *
 * Usage:
 *   URL=http://localhost:3000 TOKEN_A=... TOKEN_B=... \
 *   TOKEN_OUTSIDER=... CHAT_ID=10 node scripts/attachments.js
 *
 * Exit code is non-zero if any assertion fails.
 */

const crypto = require('node:crypto');
const sharp = require('sharp');
const { io } = require('socket.io-client');

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A ?? '';
const TOKEN_B = process.env.TOKEN_B ?? '';
const TOKEN_OUT = process.env.TOKEN_OUTSIDER ?? '';
const CHAT_ID = Number(process.env.CHAT_ID);
const CHAT_ID_2 = process.env.CHAT_ID_2
    ? Number(process.env.CHAT_ID_2)
    : null;
const ORPHAN_WAIT_MS = Number(process.env.ORPHAN_WAIT_MS ?? 0);
/** Must match the mobile app and the backend interceptor. */
const APP_UPLOAD_FIELD = 'files';

let passed = 0;
let failed = 0;
let skipped = 0;

function log(status, name, detail) {
    const suffix = detail === undefined ? '' : ` — ${detail}`;
    console.log(`${status.padEnd(4)} ${name}${suffix}`);
}

async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        log('PASS', name);
    } catch (error) {
        failed += 1;
        log('FAIL', name, error instanceof Error ? error.message : String(error));
    }
}

function skip(name, reason) {
    skipped += 1;
    log('SKIP', name, reason);
}

function check(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function headers(token, extra = {}) {
    return { Authorization: `Bearer ${token}`, ...extra };
}

async function readJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

async function upload(token, files, chatId = CHAT_ID) {
    const form = new FormData();
    for (const file of files) {
        form.append(
            APP_UPLOAD_FIELD,
            new Blob([file.buffer], { type: file.type }),
            file.name,
        );
    }
    const response = await fetch(`${BASE}/chats/${chatId}/attachments`, {
        method: 'POST',
        headers: headers(token),
        body: form,
    });
    return { status: response.status, body: await readJson(response) };
}

function connect(token) {
    return new Promise((resolve, reject) => {
        const socket = io(BASE, {
            transports: ['websocket'],
            extraHeaders: { authorization: `Bearer ${token}` },
            auth: { token },
            reconnection: false,
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('socket connect timed out'));
        }, 8000);
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

function request(socket, event, payload, timeout = 15000) {
    return new Promise((resolve) => {
        const timer = setTimeout(
            () => resolve({ ok: false, message: `${event} ack timed out` }),
            timeout,
        );
        socket.emit(event, payload, (response) => {
            clearTimeout(timer);
            resolve(response ?? { ok: false, message: 'empty ack' });
        });
    });
}

function waitFor(socket, event, predicate, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`${event} not received`));
        }, timeout);
        const handler = (payload) => {
            if (predicate(payload)) {
                clearTimeout(timer);
                socket.off(event, handler);
                resolve(payload);
            }
        };
        socket.on(event, handler);
    });
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const missing = [];
    if (BASE === '') missing.push('URL');
    if (TOKEN_A === '') missing.push('TOKEN_A');
    if (TOKEN_B === '') missing.push('TOKEN_B');
    if (TOKEN_OUT === '') missing.push('TOKEN_OUTSIDER');
    if (!Number.isInteger(CHAT_ID) || CHAT_ID <= 0) missing.push('CHAT_ID');
    if (missing.length > 0) {
        console.error(`Missing/invalid env: ${missing.join(', ')}`);
        process.exit(2);
    }

    const png = await sharp({
        create: {
            width: 160,
            height: 120,
            channels: 3,
            background: '#2196F3',
        },
    })
        .png()
        .toBuffer();
    const pdf = Buffer.from(
        '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
    );
    const persianName = 'گزارش-آزمایش.pdf';
    const imageFile = { buffer: png, name: 'photo.png', type: 'image/png' };
    const pdfFile = {
        buffer: pdf,
        name: persianName,
        type: 'application/pdf',
    };

    const socketA = await connect(TOKEN_A);
    const socketB = await connect(TOKEN_B);
    await request(socketA, 'joinChat', { chatId: CHAT_ID });
    const joinedB = await request(socketB, 'joinChat', { chatId: CHAT_ID });
    check(joinedB.ok === true, 'B could not join the chat');

    let imageId = 0;
    let pdfId = 0;
    let messageId = 0;

    await test("upload route is reachable with the app's 'files' field", async () => {
        const result = await upload(TOKEN_A, [imageFile]);
        check(
            result.status === 200 || result.status === 201,
            `field '${APP_UPLOAD_FIELD}' failed: status ${result.status}: ${JSON.stringify(result.body)}`,
        );
        check(result.body?.ok === true, 'response is not { ok: true }');
        check(
            Array.isArray(result.body.data) && result.body.data.length === 1,
            'expected one attachment',
        );
    });

    await test('upload one PNG and one PDF (Persian name) as A', async () => {
        const result = await upload(TOKEN_A, [imageFile, pdfFile]);
        check(
            result.status === 200 || result.status === 201,
            `status ${result.status}: ${JSON.stringify(result.body)}`,
        );
        check(result.body?.ok === true, 'response is not { ok: true }');
        check(Array.isArray(result.body.data), 'data is not an array');
        check(result.body.data.length === 2, 'expected 2 attachments');
        const [image, document] = result.body.data;
        check(image.kind === 'image', `expected image, got ${image.kind}`);
        check(document.kind === 'file', `expected file, got ${document.kind}`);
        check(
            image.mimeType === 'image/png',
            `unexpected image mime ${image.mimeType}`,
        );
        check(
            document.mimeType === 'application/pdf',
            `unexpected pdf mime ${document.mimeType}`,
        );
        check(
            document.originalName === persianName,
            `Persian name not preserved: ${document.originalName}`,
        );
        check(image.width === 160 && image.height === 120, 'image dimensions');
        check(!('storageKey' in image), 'storage key leaked');
        imageId = image.id;
        pdfId = document.id;
    });

    await test('sendMessage with empty caption echoes ids and clientMessageId to B', async () => {
        const clientMessageId = `c_test_${Date.now().toString(36)}`;
        const echoPromise = waitFor(
            socketB,
            'sendMessage:list',
            (message) => message.clientMessageId === clientMessageId,
        );
        const ack = await request(socketA, 'sendMessage', {
            chatId: CHAT_ID,
            content: '',
            attachments: [imageId, pdfId],
            clientMessageId,
        });
        check(ack.ok === true, `ack failed: ${JSON.stringify(ack)}`);
        const data = ack.data;
        check(data.clientMessageId === clientMessageId, 'ack clientMessageId');
        check(data.attachments?.length === 2, 'ack attachment count');
        check(
            data.attachments[0].kind === 'image' &&
                data.attachments[1].kind === 'file',
            'ack attachment kinds',
        );
        check(!('storageKey' in data.attachments[0]), 'ack leaked storage key');
        messageId = data.id;

        const echo = await echoPromise;
        check(echo.id === data.id, 'echo id differs from ack id');
        check(echo.clientMessageId === clientMessageId, 'echo clientMessageId');
        check(echo.attachments?.length === 2, 'echo attachment count');
        check(
            echo.attachments[1].originalName === persianName,
            'echo Persian name',
        );
    });

    await test('B downloads both files with matching SHA-256 and safe headers', async () => {
        const imageResponse = await fetch(
            `${BASE}/attachments/${imageId}/download`,
            { headers: headers(TOKEN_B) },
        );
        check(imageResponse.status === 200, `image status ${imageResponse.status}`);
        const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
        check(sha256(imageBytes) === sha256(png), 'image bytes differ');
        check(
            imageResponse.headers.get('content-type') === 'image/png',
            'image content-type',
        );
        const imageDisposition =
            imageResponse.headers.get('content-disposition') ?? '';
        check(imageDisposition.startsWith('inline;'), 'image is not inline');
        check(
            imageResponse.headers.get('x-content-type-options') === 'nosniff',
            'missing nosniff',
        );
        const cache = imageResponse.headers.get('cache-control') ?? '';
        check(
            cache.includes('immutable') && cache.includes('private'),
            `cache-control: ${cache}`,
        );

        const pdfResponse = await fetch(
            `${BASE}/attachments/${pdfId}/download`,
            { headers: headers(TOKEN_B) },
        );
        check(pdfResponse.status === 200, `pdf status ${pdfResponse.status}`);
        const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
        check(sha256(pdfBytes) === sha256(pdf), 'pdf bytes differ');
        check(
            pdfResponse.headers.get('content-type') ===
                'application/octet-stream',
            'pdf content-type must be octet-stream',
        );
        const pdfDisposition =
            pdfResponse.headers.get('content-disposition') ?? '';
        check(pdfDisposition.startsWith('attachment;'), 'pdf is not attachment');
        check(
            pdfDisposition.includes(
                `filename*=UTF-8''${encodeURIComponent(persianName)}`,
            ),
            `missing UTF-8 filename: ${pdfDisposition}`,
        );
        check(
            /filename="[\x20-\x7e]+"/.test(pdfDisposition),
            'missing ASCII fallback filename',
        );
    });

    await test('download answers 304 on If-None-Match', async () => {
        const first = await fetch(`${BASE}/attachments/${imageId}/download`, {
            headers: headers(TOKEN_B),
        });
        const etag = first.headers.get('etag');
        check(etag !== null, 'missing ETag');
        const second = await fetch(`${BASE}/attachments/${imageId}/download`, {
            headers: headers(TOKEN_B, { 'If-None-Match': etag }),
        });
        check(second.status === 304, `expected 304, got ${second.status}`);
    });

    await test('preview is WebP no wider than the requested size, cacheable', async () => {
        const response = await fetch(
            `${BASE}/attachments/${imageId}/preview?size=320`,
            { headers: headers(TOKEN_B) },
        );
        check(response.status === 200, `preview status ${response.status}`);
        check(
            response.headers.get('content-type') === 'image/webp',
            'preview content-type',
        );
        check(
            (response.headers.get('cache-control') ?? '').includes('immutable'),
            'preview cache-control',
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        const metadata = await sharp(bytes).metadata();
        check(metadata.format === 'webp', `format ${metadata.format}`);
        check((metadata.width ?? 9999) <= 320, `width ${metadata.width}`);
    });

    await test('outsider gets 404 for download/preview and cannot upload', async () => {
        const download = await fetch(
            `${BASE}/attachments/${imageId}/download`,
            { headers: headers(TOKEN_OUT) },
        );
        check(download.status === 404, `download ${download.status}`);
        const preview = await fetch(
            `${BASE}/attachments/${imageId}/preview?size=320`,
            { headers: headers(TOKEN_OUT) },
        );
        check(preview.status === 404, `preview ${preview.status}`);
        const uploadResult = await upload(TOKEN_OUT, [imageFile]);
        check(
            uploadResult.status === 403 || uploadResult.status === 404,
            `upload ${uploadResult.status}`,
        );
    });

    await test('oversized (25 MB) upload is rejected with 413', async () => {
        const result = await upload(TOKEN_A, [
            {
                buffer: Buffer.alloc(25 * 1024 * 1024, 1),
                name: 'big.bin',
                type: 'application/octet-stream',
            },
        ]);
        check(result.status === 413, `status ${result.status}`);
        check(result.body?.data === undefined, 'unexpected attachment id');
    });

    await test('.exe upload is rejected with 400', async () => {
        const result = await upload(TOKEN_A, [
            { buffer: Buffer.from('MZ'), name: 'virus.exe', type: 'application/octet-stream' },
        ]);
        check(result.status === 400, `status ${result.status}`);
    });

    await test('11 files in one request are rejected with 400', async () => {
        const result = await upload(
            TOKEN_A,
            Array.from({ length: 11 }, () => ({
                buffer: png,
                name: 'x.png',
                type: 'image/png',
            })),
        );
        check(result.status === 400, `status ${result.status}`);
    });

    await test('text renamed to .png is rejected as an invalid image', async () => {
        const result = await upload(TOKEN_A, [
            {
                buffer: Buffer.from('not an image at all'),
                name: 'notes.png',
                type: 'image/png',
            },
        ]);
        check(result.status === 400, `status ${result.status}`);
        // Server behavior chosen by the implementation: reject (not "file").
    });

    let pendingId = 0;
    await test("another user's attachment id and duplicate ids are rejected", async () => {
        const uploaded = await upload(TOKEN_A, [pdfFile]);
        check(
            uploaded.status === 201 || uploaded.status === 200,
            `setup upload: status ${uploaded.status} ${JSON.stringify(uploaded.body)}`,
        );
        pendingId = uploaded.body.data[0].id;

        const byB = await request(socketB, 'sendMessage', {
            chatId: CHAT_ID,
            content: 'steal',
            attachments: [pendingId],
            clientMessageId: 'c_steal',
        });
        check(byB.ok !== true, 'B claimed an attachment uploaded by A');

        const duplicate = await request(socketA, 'sendMessage', {
            chatId: CHAT_ID,
            content: 'dup',
            attachments: [pendingId, pendingId],
            clientMessageId: 'c_dup',
        });
        check(duplicate.ok !== true, 'duplicate ids were accepted');
    });

    if (CHAT_ID_2 !== null) {
        await test('an attachment from another chat is rejected', async () => {
            const uploaded = await upload(TOKEN_A, [pdfFile], CHAT_ID_2);
            check(
            uploaded.status === 201 || uploaded.status === 200,
            `setup: status ${uploaded.status} ${JSON.stringify(uploaded.body)}`,
        );
            const foreignId = uploaded.body.data[0].id;
            const ack = await request(socketA, 'sendMessage', {
                chatId: CHAT_ID,
                content: 'wrong chat',
                attachments: [foreignId],
                clientMessageId: 'c_wrong_chat',
            });
            check(ack.ok !== true, 'cross-chat attachment accepted');
        });
    } else {
        skip('an attachment from another chat is rejected', 'CHAT_ID_2 not set');
    }

    await test('a message with neither text nor attachments is rejected', async () => {
        const ack = await request(socketA, 'sendMessage', {
            chatId: CHAT_ID,
            clientMessageId: 'c_empty',
        });
        check(ack.ok !== true, 'empty message accepted');
    });

    await test('two concurrent sends claiming one attachment: exactly one wins', async () => {
        const uploaded = await upload(TOKEN_A, [imageFile]);
        check(
            uploaded.status === 201 || uploaded.status === 200,
            `setup: status ${uploaded.status} ${JSON.stringify(uploaded.body)}`,
        );
        const claimId = uploaded.body.data[0].id;
        const results = await Promise.all([
            request(socketA, 'sendMessage', {
                chatId: CHAT_ID,
                content: 'race 1',
                attachments: [claimId],
                clientMessageId: 'c_race_1',
            }),
            request(socketA, 'sendMessage', {
                chatId: CHAT_ID,
                content: 'race 2',
                attachments: [claimId],
                clientMessageId: 'c_race_2',
            }),
        ]);
        const winners = results.filter((result) => result.ok === true);
        check(
            winners.length === 1,
            `expected exactly 1 winner, got ${winners.length}`,
        );
    });

    await test('deleting the message makes downloads 404 for everyone', async () => {
        const deleted = await request(socketA, 'deleteMessage', {
            chatId: CHAT_ID,
            messageId,
        });
        check(deleted.ok === true, `delete failed: ${JSON.stringify(deleted)}`);
        await sleep(300);
        const response = await fetch(
            `${BASE}/attachments/${imageId}/download`,
            { headers: headers(TOKEN_B) },
        );
        check(response.status === 404, `status ${response.status}`);
    });

    if (ORPHAN_WAIT_MS > 0) {
        await test('orphan cleanup removes an old unattached upload', async () => {
            const uploaded = await upload(TOKEN_A, [imageFile]);
            check(
            uploaded.status === 201 || uploaded.status === 200,
            `setup: status ${uploaded.status} ${JSON.stringify(uploaded.body)}`,
        );
            const orphanId = uploaded.body.data[0].id;
            await sleep(ORPHAN_WAIT_MS);
            const response = await fetch(
                `${BASE}/attachments/${orphanId}/download`,
                { headers: headers(TOKEN_A) },
            );
            check(response.status === 404, `status ${response.status}`);
        });
    } else {
        skip(
            'orphan cleanup removes an old unattached upload',
            'set ORPHAN_WAIT_MS and start the backend with a short ATTACHMENT_ORPHAN_TTL_MS + ATTACHMENT_CLEANUP_INTERVAL_MS',
        );
    }

    socketA.close();
    socketB.close();

    // `pendingId` remains unused on purpose: it is an orphan upload that the
    // TTL job removes (see the orphan test above).
    void pendingId;

    console.log(
        `\n${passed} passed, ${failed} failed, ${skipped} skipped`,
    );
    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
