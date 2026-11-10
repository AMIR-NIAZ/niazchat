#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * End-to-end checks for attachment message actions.
 *
 * Required env:
 *   URL       API origin (no trailing slash)
 *   TOKEN_A   sender/owner token (member of CHAT_ID)
 *   TOKEN_B   other member token
 *   CHAT_ID   chat where both are members
 *
 * Optional:
 *   CLEANUP_WAIT_MS  extra wait after delete before the 404 checks
 *
 * Usage:
 *   URL=http://localhost:3000 TOKEN_A=... TOKEN_B=... CHAT_ID=10 \
 *     node scripts/message-actions-attachments.js
 *
 * Voice/video fixtures need ffmpeg; those cases are SKIPped when it is absent.
 * Exit code 1 on any FAIL, 2 on missing configuration.
 */

const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');
const sharp = require('sharp');

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A ?? '';
const TOKEN_B = process.env.TOKEN_B ?? '';
const CHAT_ID = Number(process.env.CHAT_ID);
const CLEANUP_WAIT_MS = Number(process.env.CLEANUP_WAIT_MS ?? 0);

let passed = 0;
let failed = 0;
let skipped = 0;

function log(status, name, detail) {
    console.log(
        `${status.padEnd(4)} ${name}${detail === undefined ? '' : ` — ${detail}`}`,
    );
}

function check(condition, message) {
    if (!condition) throw new Error(message);
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

function skip(name, reason) {
    skipped += 1;
    log('SKIP', name, reason);
}

function headers(token) {
    return { Authorization: `Bearer ${token}` };
}

async function readJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

async function upload(token, buffer, name, type, voice = false) {
    const form = new FormData();
    if (voice) form.append('voice', '1');
    form.append('files', new Blob([buffer], { type }), name);
    const response = await fetch(`${BASE}/chats/${CHAT_ID}/attachments`, {
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

function request(socket, event, payload, timeout = 20000) {
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
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        };
        socket.on(event, handler);
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeVoice() {
    const sampleRate = 8000;
    const samples = sampleRate / 2;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + samples * 2, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i += 1) {
        wav.writeInt16LE(
            Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
            44 + i * 2,
        );
    }
    return execFileSync(
        'ffmpeg',
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'wav',
            '-i',
            'pipe:0',
            '-c:a',
            'aac',
            '-b:a',
            '48k',
            '-f',
            'mp4',
            'pipe:1',
        ],
        { input: wav, maxBuffer: 2 * 1024 * 1024 },
    );
}

function makeVideo() {
    return execFileSync(
        'ffmpeg',
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'testsrc=size=160x120:rate=15:duration=1',
            '-c:v',
            'mpeg4',
            '-q:v',
            '6',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            'frag_keyframe+empty_moov',
            '-f',
            'mp4',
            'pipe:1',
        ],
        { maxBuffer: 8 * 1024 * 1024 },
    );
}

async function send(socket, content, attachmentIds) {
    return request(socket, 'sendMessage', {
        chatId: CHAT_ID,
        content,
        ...(attachmentIds.length > 0 ? { attachments: attachmentIds } : {}),
        clientMessageId: `ca_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
    });
}

async function download(token, id) {
    return fetch(`${BASE}/attachments/${id}/download`, {
        headers: headers(token),
    });
}

async function main() {
    const missing = [];
    if (BASE === '') missing.push('URL');
    if (TOKEN_A === '') missing.push('TOKEN_A');
    if (TOKEN_B === '') missing.push('TOKEN_B');
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
            background: '#1E88E5',
        },
    })
        .png()
        .toBuffer();
    const pdf = Buffer.from(
        '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
    );
    const imageFile = { buffer: png, name: 'photo.png', type: 'image/png' };
    const documentFile = {
        buffer: pdf,
        name: 'گزارش-آزمایش.pdf',
        type: 'application/pdf',
    };

    let voiceFile = null;
    let videoFile = null;
    try {
        voiceFile = {
            buffer: makeVoice(),
            name: 'voice.m4a',
            type: 'audio/mp4',
        };
    } catch {
        // ffmpeg unavailable: skip voice cases below.
    }
    try {
        videoFile = {
            buffer: makeVideo(),
            name: 'clip.mp4',
            type: 'video/mp4',
        };
    } catch {
        // ffmpeg unavailable: skip video cases below.
    }

    const socketA = await connect(TOKEN_A);
    const socketB = await connect(TOKEN_B);
    const joined = await request(socketB, 'joinChat', { chatId: CHAT_ID });
    check(joined.ok === true, `B join failed: ${JSON.stringify(joined)}`);
    await request(socketA, 'joinChat', { chatId: CHAT_ID });

    let imageMessage = null;
    let documentMessage = null;
    let voiceMessage = null;
    let videoMessage = null;
    let imageAttachmentId = null;

    await test('A sends an image with a caption', async () => {
        const up = await upload(
            TOKEN_A,
            imageFile.buffer,
            imageFile.name,
            imageFile.type,
        );
        check(up.status === 201 || up.status === 200, `upload ${up.status}`);
        imageAttachmentId = up.body.data[0].id;
        const ack = await send(socketA, 'original caption', [
            imageAttachmentId,
        ]);
        check(ack.ok === true, `send: ${JSON.stringify(ack)}`);
        check(ack.data.attachments?.[0]?.kind === 'image', 'not an image');
        imageMessage = ack.data;
    });

    await test('A sends an attachment-only document', async () => {
        const up = await upload(
            TOKEN_A,
            documentFile.buffer,
            documentFile.name,
            documentFile.type,
        );
        check(up.status === 201 || up.status === 200, `upload ${up.status}`);
        const ack = await send(socketA, '', [up.body.data[0].id]);
        check(ack.ok === true, `send: ${JSON.stringify(ack)}`);
        check(ack.data.attachments?.[0]?.kind === 'file', 'not a file');
        documentMessage = ack.data;
    });

    if (voiceFile !== null) {
        await test('A sends a voice message', async () => {
            const up = await upload(
                TOKEN_A,
                voiceFile.buffer,
                voiceFile.name,
                voiceFile.type,
                true,
            );
            check(
                up.status === 201 || up.status === 200,
                `upload ${up.status}`,
            );
            check(up.body.data[0].kind === 'voice', 'not voice');
            const ack = await send(socketA, '', [up.body.data[0].id]);
            check(ack.ok === true, `send: ${JSON.stringify(ack)}`);
            voiceMessage = ack.data;
        });
    } else {
        skip('A sends a voice message', 'ffmpeg is not available');
    }

    if (videoFile !== null) {
        await test('A sends a video', async () => {
            const up = await upload(
                TOKEN_A,
                videoFile.buffer,
                videoFile.name,
                videoFile.type,
            );
            check(
                up.status === 201 || up.status === 200,
                `upload ${up.status}`,
            );
            check(up.body.data[0].kind === 'video', 'not video');
            const ack = await send(socketA, '', [up.body.data[0].id]);
            check(ack.ok === true, `send: ${JSON.stringify(ack)}`);
            videoMessage = ack.data;
        });
    } else {
        skip('A sends a video', 'ffmpeg is not available');
    }

    await test("B cannot delete A's document", async () => {
        const ack = await request(socketB, 'deleteMessage', {
            chatId: CHAT_ID,
            messageId: documentMessage.id,
        });
        check(ack.ok === false, 'B deleted another user message');
        check(
            typeof ack.message === 'string' && ack.message.length > 0,
            'no reason',
        );
    });

    await test('editing a forwarded copy is rejected', async () => {
        const ack = await request(socketA, 'forwardMessages', {
            fromChatId: CHAT_ID,
            messageIds: [imageMessage.id],
            toChatIds: [CHAT_ID],
            requestId: `ca_fwd_${Date.now().toString(36)}`,
        });
        check(ack.ok === true, `forward: ${JSON.stringify(ack)}`);
        const forwardedId = ack.data.results.find((r) => r.ok === true)
            ?.messageIds?.[0];
        check(Number.isInteger(forwardedId), 'no forwarded id');
        const edit = await request(socketA, 'editMessage', {
            chatId: CHAT_ID,
            messageId: forwardedId,
            newContent: 'changed forwarded',
        });
        check(edit.ok === false, 'forwarded message edited');
        check(/forwarded/i.test(edit.message ?? ''), `reason: ${edit.message}`);
    });

    await test('A edits the image caption; B gets the same attachments', async () => {
        const echoPromise = waitFor(
            socketB,
            'editMessage:list',
            (message) => message.id === imageMessage.id,
        );
        const ack = await request(socketA, 'editMessage', {
            chatId: CHAT_ID,
            messageId: imageMessage.id,
            newContent: 'edited caption',
        });
        check(ack.ok === true, `edit: ${JSON.stringify(ack)}`);
        check(ack.data.content === 'edited caption', 'ack content');
        check(ack.data.isEdited === true, 'ack isEdited');
        check(ack.data.attachments?.length === 1, 'ack lost attachments');
        check(
            ack.data.attachments[0].id === imageAttachmentId,
            'ack attachment changed',
        );
        const echo = await echoPromise;
        check(echo.content === 'edited caption', 'echo content');
        check(echo.isEdited === true, 'echo isEdited');
        check(echo.attachments?.length === 1, 'echo lost attachments');
        check(
            echo.attachments[0].id === imageAttachmentId,
            'echo attachment id',
        );
    });

    await test('editing an attachment-only document is rejected', async () => {
        const ack = await request(socketA, 'editMessage', {
            chatId: CHAT_ID,
            messageId: documentMessage.id,
            newContent: 'add a caption',
        });
        check(ack.ok === false, 'attachment-only message edited');
        check(
            /without text/i.test(ack.message ?? ''),
            `reason: ${ack.message}`,
        );
    });

    await test('editing with empty text is rejected', async () => {
        const ack = await request(socketA, 'editMessage', {
            chatId: CHAT_ID,
            messageId: imageMessage.id,
            newContent: '   ',
        });
        check(ack.ok === false, 'empty edit accepted');
        check(
            /content is required/i.test(ack.message ?? ''),
            `reason: ${ack.message}`,
        );
    });

    if (voiceMessage !== null) {
        await test('editing a voice message is rejected', async () => {
            const ack = await request(socketA, 'editMessage', {
                chatId: CHAT_ID,
                messageId: voiceMessage.id,
                newContent: 'x',
            });
            check(ack.ok === false, 'voice edited');
            check(/voice/i.test(ack.message ?? ''), `reason: ${ack.message}`);
        });
    } else {
        skip('editing a voice message is rejected', 'ffmpeg is not available');
    }

    const page = await request(socketA, 'getMessages', { chatId: CHAT_ID });
    check(page.ok === true, 'getMessages failed');
    const listedImage = page.data.messages.find(
        (m) => m.id === imageMessage.id,
    );
    check(listedImage?.content === 'edited caption', 'history lost the edit');
    check(
        listedImage?.attachments?.[0]?.id === imageAttachmentId,
        'history lost the attachment',
    );

    async function deleteMessage(message, label) {
        const eventPromise = waitFor(
            socketB,
            'deleteMessage:list',
            (payload) => Number(payload) === message.id,
        );
        const ack = await request(socketA, 'deleteMessage', {
            chatId: CHAT_ID,
            messageId: message.id,
        });
        check(ack.ok === true, `${label} delete: ${JSON.stringify(ack)}`);
        await eventPromise;
        if (CLEANUP_WAIT_MS > 0) await sleep(CLEANUP_WAIT_MS);
        for (const attachment of message.attachments ?? []) {
            const response = await download(TOKEN_B, attachment.id);
            check(
                response.status === 404,
                `${label} attachment ${attachment.id} still ${response.status}`,
            );
        }
    }

    await test('deleting the image removes it for B and blocks its download', async () => {
        await deleteMessage(imageMessage, 'image');
    });
    await test('deleting the document removes it for B and blocks its download', async () => {
        await deleteMessage(documentMessage, 'document');
    });
    if (voiceMessage !== null) {
        await test('deleting the voice message removes it for B', async () => {
            await deleteMessage(voiceMessage, 'voice');
        });
    }
    if (videoMessage !== null) {
        await test('deleting the video removes it for B', async () => {
            await deleteMessage(videoMessage, 'video');
        });
    }

    await test('history no longer contains the deleted messages', async () => {
        const after = await request(socketA, 'getMessages', {
            chatId: CHAT_ID,
        });
        check(after.ok === true, 'getMessages failed');
        const deletedIds = new Set(
            [imageMessage, documentMessage, voiceMessage, videoMessage]
                .filter((message) => message !== null)
                .map((message) => message.id),
        );
        check(
            !after.data.messages.some((message) => deletedIds.has(message.id)),
            'a deleted message is still in history',
        );
    });

    socketA.close();
    socketB.close();
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
