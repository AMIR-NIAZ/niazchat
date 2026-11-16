#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Music (audio) attachment check: HTTP upload validation + metadata + Range
 * download + the `music` message type over the WebSocket.
 *
 * Required env:
 *   URL      http(s) origin of the API (no trailing slash)
 *   TOKEN    access token of a member of CHAT_ID
 *   CHAT_ID  chat the token may upload/send to
 *
 * Optional:
 *   OVERSIZE_MB  size of the oversize probe in MiB (default 101; must exceed
 *                the 100 MiB music limit)
 *
 * Usage:
 *   URL=http://localhost:3000 TOKEN=... CHAT_ID=10 node scripts/music-upload.js
 *
 * Exit code is non-zero if any assertion fails.
 */

const { io } = require('socket.io-client');

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN ?? '';
const CHAT_ID = Number(process.env.CHAT_ID);
const OVERSIZE_MB = Number(process.env.OVERSIZE_MB ?? 101);
/** Must match the mobile app and the backend interceptor. */
const APP_UPLOAD_FIELD = 'files';

/**
 * 960-byte MP3: 1.2 s 440 Hz tone, ID3v2 title "Test Track", artist
 * "Test Artist", album "Test Album" and an embedded 120x120 JPEG cover.
 * Generated once with:
 *   ffmpeg -f lavfi -i "sine=frequency=440:duration=1.2" \
 *     -f lavfi -i "color=c=#7545B8:s=120x120:d=1" -map 0:a -map 1:v \
 *     -c:a libmp3lame -b:a 48k -c:v mjpeg -frames:v 1 -id3v2_version 3 \
 *     -metadata title="Test Track" -metadata artist="Test Artist" \
 *     -metadata album="Test Album" -metadata:s:v title="Album cover" \
 *     -metadata:s:v comment="Cover (front)" -shortest fixture.mp3
 */
const MP3_BASE64 =
    'SUQzAwAAAAADR1RJVDIAAAAMAAAAVGVzdCBUcmFjawBUUEUxAAAADQAAAFRlc3QgQXJ0aXN0AFRBTEIAAAAMAAAAVGVzdCBBbGJ1bQBUU1NFAAAADgAAAExhdmY2My4xLjEwMgBBUElDAAABWAAAAGltYWdlL2pwZWcAA0FsYnVtIGNvdmVyAP/Y/+AAEEpGSUYAAQIAAAEAAQAA//4AD0xhdmM2My4xLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABNAAEBAAAAAAAAAAAAAAAAAAAABQEBAQEAAAAAAAAAAAAAAAAAAAQGEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAeAB4AwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AgANguAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/9kAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAAB7wCurq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6u//////////////////////////////////////////////////////////////////8AAAAATGF2YzYzLjEuAAAAAAAAAAAAAAAAJAJAAAAAAAAAAe+D5D3iAAAAAAD/+zDEAAAF5BVXVGCAMUCQqTc20AAAAa1LpGwCZMnpgIAAAQsHwfB8+CAIAhrB/UCAIHJcHw/iAEIOO7+U8/ynn+j39AAAGloFAoHAwFAgAAAAXAAvCRAEsU4ARIzYFfYMpLotqXTIQowkKe7su8JqCu+CsifCZfiXEiPUcP+O4YYS4kR6/+SJkXi8Yl38JA0JTv8GlQ4MFwbMEwb/+zLEA4NHhDUyPdMAAOaHJ8mMmJnMCwfMEwdAw3mgsEmpgAiRqkQkFALCQHI1JrsTa+77/xsAECBAgQIQCYPg+D///9/R7+j39ANOkl8XKApDeQQfO6cDOl3VNlhl1P8/0PAIBAIiRIkSJEjJtBQUFBQKCgoKDBQUFBQKCgoKDBQUFFFMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVV';

let passed = 0;
let failed = 0;

function log(status, name, detail) {
    console.log(
        `${status.padEnd(4)} ${name}${detail === undefined ? '' : ` — ${detail}`}`,
    );
}

async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        log('PASS', name);
    } catch (error) {
        failed += 1;
        log(
            'FAIL',
            name,
            error instanceof Error ? error.message : String(error),
        );
    }
}

function check(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function headers(extra = {}) {
    return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function readJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

async function upload(files) {
    const form = new FormData();
    for (const file of files) {
        form.append(
            APP_UPLOAD_FIELD,
            new Blob([file.buffer], { type: file.type }),
            file.name,
        );
    }
    const response = await fetch(`${BASE}/chats/${CHAT_ID}/attachments`, {
        method: 'POST',
        headers: headers(),
        body: form,
    });
    return { status: response.status, body: await readJson(response) };
}

function connect() {
    return new Promise((resolve, reject) => {
        const socket = io(BASE, {
            transports: ['websocket'],
            extraHeaders: { authorization: `Bearer ${TOKEN}` },
            auth: { token: TOKEN },
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

async function main() {
    const missing = [];
    if (BASE === '') missing.push('URL');
    if (TOKEN === '') missing.push('TOKEN');
    if (!Number.isInteger(CHAT_ID) || CHAT_ID <= 0) missing.push('CHAT_ID');
    if (missing.length > 0) {
        console.error(`Missing/invalid env: ${missing.join(', ')}`);
        process.exit(2);
    }

    const mp3 = Buffer.from(MP3_BASE64, 'base64');
    const trackFile = { buffer: mp3, name: 'Test Track.mp3', type: 'audio/mpeg' };
    let attachmentId = 0;

    await test('small MP3 uploads as kind "music" with metadata', async () => {
        const result = await upload([trackFile]);
        check(
            result.status === 200 || result.status === 201,
            `status ${result.status}: ${JSON.stringify(result.body)}`,
        );
        check(result.body?.ok === true, 'response is not { ok: true }');
        const item = result.body?.data?.[0];
        check(item !== undefined, 'no attachment in the response');
        check(item.kind === 'music', `expected kind music, got ${item.kind}`);
        check(
            item.mimeType === 'audio/mpeg',
            `unexpected mime ${item.mimeType}`,
        );
        check(typeof item.size === 'number' && item.size > 0, 'missing size');
        check(
            typeof item.title === 'string' && item.title.trim() !== '',
            'title must be a non-empty string',
        );
        check(
            item.artist === null || typeof item.artist === 'string',
            'artist must be a string or null',
        );
        check(
            item.durationSeconds === null ||
                (typeof item.durationSeconds === 'number' &&
                    item.durationSeconds > 0),
            'durationSeconds must be a positive number or null',
        );
        check(
            item.coverUrl === null ||
                item.coverUrl === `/attachments/${item.id}/cover`,
            `unexpected coverUrl ${item.coverUrl}`,
        );
        check(!('storageKey' in item), 'storage key leaked');
        // The fixture carries tags and a cover; the exact tag text is
        // asserted (duration is a valid number either way).
        check(
            item.title === 'Test Track',
            `unexpected title ${item.title}`,
        );
        check(
            item.artist === 'Test Artist',
            `unexpected artist ${item.artist}`,
        );
        attachmentId = item.id;
    });

    await test('metadata defaults are sensible for an untagged file', async () => {
        // A valid MPEG frame sync without any tag: the upload must still
        // succeed and expose a usable title (file name) with null artist.
        const untagged = Buffer.concat([
            Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]),
            Buffer.alloc(2048, 0),
        ]);
        const result = await upload([
            { buffer: untagged, name: 'no tags.mp3', type: 'audio/mpeg' },
        ]);
        check(
            result.status === 200 || result.status === 201,
            `status ${result.status}: ${JSON.stringify(result.body)}`,
        );
        const item = result.body?.data?.[0];
        check(item?.kind === 'music', `expected music, got ${item?.kind}`);
        check(
            typeof item.title === 'string' && item.title.trim() !== '',
            'fallback title missing',
        );
        check(
            item.artist === null || typeof item.artist === 'string',
            'artist must be a string or null',
        );
    });

    await test('download is inline audio with Accept-Ranges, Range answers 206', async () => {
        const full = await fetch(
            `${BASE}/attachments/${attachmentId}/download`,
            { headers: headers() },
        );
        check(full.status === 200, `full GET status ${full.status}`);
        check(
            (full.headers.get('content-type') ?? '').startsWith('audio/'),
            `content-type ${full.headers.get('content-type')}`,
        );
        check(
            full.headers.get('accept-ranges') === 'bytes',
            'Accept-Ranges is not bytes',
        );
        check(
            (full.headers.get('content-disposition') ?? '').startsWith(
                'inline;',
            ),
            'music is not served inline',
        );
        const length = Number(full.headers.get('content-length'));
        check(length === mp3.length, `content-length ${length}`);

        const partial = await fetch(
            `${BASE}/attachments/${attachmentId}/download`,
            { headers: headers({ Range: 'bytes=0-99' }) },
        );
        check(partial.status === 206, `range status ${partial.status}`);
        const range = partial.headers.get('content-range') ?? '';
        check(
            range === `bytes 0-99/${mp3.length}`,
            `content-range ${range}`,
        );
        check(
            partial.headers.get('content-length') === '100',
            'range content-length is wrong',
        );
    });

    await test('cover route serves a WebP for a tagged track', async () => {
        const response = await fetch(
            `${BASE}/attachments/${attachmentId}/cover`,
            { headers: headers() },
        );
        check(response.status === 200, `cover status ${response.status}`);
        check(
            response.headers.get('content-type') === 'image/webp',
            `cover content-type ${response.headers.get('content-type')}`,
        );
    });

    await test('.exe upload is rejected with 400', async () => {
        const result = await upload([
            {
                buffer: Buffer.from('MZ'),
                name: 'virus.exe',
                type: 'application/octet-stream',
            },
        ]);
        check(result.status === 400, `status ${result.status}`);
    });

    await test('a renamed non-audio .mp3 is rejected with 400', async () => {
        const result = await upload([
            {
                buffer: Buffer.from('this is definitely not audio'),
                name: 'fake.mp3',
                type: 'audio/mpeg',
            },
        ]);
        check(result.status === 400, `status ${result.status}`);
    });

    await test(`oversize (${OVERSIZE_MB} MiB) music upload is rejected with 413`, async () => {
        check(
            OVERSIZE_MB > 100,
            'OVERSIZE_MB must exceed the 100 MiB music limit',
        );
        const result = await upload([
            {
                buffer: Buffer.alloc(OVERSIZE_MB * 1024 * 1024, 1),
                name: 'huge.mp3',
                type: 'audio/mpeg',
            },
        ]);
        check(result.status === 413, `status ${result.status}`);
    });

    const socket = await connect();
    try {
        await request(socket, 'joinChat', { chatId: CHAT_ID });

        await test('sendMessage type "music" echoes the track metadata', async () => {
            const clientMessageId = `c_music_${Date.now().toString(36)}`;
            const uploaded = await upload([trackFile]);
            check(
                uploaded.status === 200 || uploaded.status === 201,
                `setup upload: ${uploaded.status}`,
            );
            const id = uploaded.body.data[0].id;
            const ack = await request(socket, 'sendMessage', {
                chatId: CHAT_ID,
                content: 'my caption',
                attachments: [id],
                clientMessageId,
                type: 'music',
            });
            check(ack.ok === true, `ack failed: ${JSON.stringify(ack)}`);
            const data = ack.data;
            check(
                data.type?.name === 'music',
                `ack type ${data.type?.name}`,
            );
            check(
                data.attachments?.length === 1 &&
                    data.attachments[0].kind === 'music',
                'ack attachment is not music',
            );
            check(
                typeof data.attachments[0].title === 'string',
                'ack has no title',
            );
            check(
                data.attachments[0].coverUrl === `/attachments/${id}/cover`,
                `ack coverUrl ${data.attachments[0].coverUrl}`,
            );
            check(data.clientMessageId === clientMessageId, 'ack clientMessageId');
            check(data.content === 'my caption', 'caption lost');
        });

        await test('a music message with two attachments is rejected', async () => {
            const first = await upload([trackFile]);
            const second = await upload([trackFile]);
            check(
                first.status === 201 || first.status === 200,
                `setup upload: ${first.status}`,
            );
            check(
                second.status === 201 || second.status === 200,
                `setup upload: ${second.status}`,
            );
            const ack = await request(socket, 'sendMessage', {
                chatId: CHAT_ID,
                content: '',
                attachments: [
                    first.body.data[0].id,
                    second.body.data[0].id,
                ],
                type: 'music',
            });
            check(ack.ok !== true, 'two-attachment music message accepted');
        });
    } finally {
        socket.close();
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
