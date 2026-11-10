#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * End-to-end message forwarding check.
 *
 * Required env:
 *   URL            API origin (no trailing slash)
 *   TOKEN_A        access token: member of CHAT_ID and CHAT_ID_2, original sender
 *   TOKEN_B        access token: member of CHAT_ID_2, receives forwarded echoes
 *   TOKEN_OUTSIDER non-member token for source/target authorization checks
 *   CHAT_ID        source chat id
 *   CHAT_ID_2      target chat id (A + B are members; outsider is not)
 *
 * Optional:
 *   CLEANUP_WAIT_MS     wait after deleting the original before re-downloading
 *                       (default 0 = only verify the hard-link copy survives)
 *   RATE_LIMIT_WAIT_MS  wait after the 21st request before the recovery check
 *                       (default 0 = skip the recovery wait)
 *
 * Usage:
 *   URL=http://localhost:3000 TOKEN_A=... TOKEN_B=... \
 *   TOKEN_OUTSIDER=... CHAT_ID=10 CHAT_ID_2=11 node scripts/forward-messages.js
 *
 * Exit code 1 on any FAIL, 2 on missing configuration. Voice generation needs
 * `ffmpeg` on PATH (same requirement as the backend media pipeline).
 */

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');
const sharp = require('sharp');

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A ?? '';
const TOKEN_B = process.env.TOKEN_B ?? '';
const TOKEN_OUT = process.env.TOKEN_OUTSIDER ?? '';
const CHAT_ID = Number(process.env.CHAT_ID);
const CHAT_ID_2 = Number(process.env.CHAT_ID_2);
const CLEANUP_WAIT_MS = Number(process.env.CLEANUP_WAIT_MS ?? 0);
const RATE_LIMIT_WAIT_MS = Number(process.env.RATE_LIMIT_WAIT_MS ?? 0);

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

function waitFor(socket, event, predicate, timeout = 10000) {
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

async function waitForMany(socket, event, predicate, count, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const found = [];
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(
                new Error(
                    `received ${found.length}/${count} ${event} events (${JSON.stringify(found)})`,
                ),
            );
        }, timeout);
        const handler = (payload) => {
            if (!predicate(payload)) return;
            found.push(payload);
            if (found.length === count) {
                clearTimeout(timer);
                socket.off(event, handler);
                resolve(found);
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

async function upload(token, chatId, files, voice = false) {
    const form = new FormData();
    if (voice) form.append('voice', '1');
    for (const file of files) {
        form.append('files', new Blob([file.buffer], { type: file.type }), file.name);
    }
    const response = await fetch(`${BASE}/chats/${chatId}/attachments`, {
        method: 'POST',
        headers: headers(token),
        body: form,
    });
    return { status: response.status, body: await readJson(response) };
}

async function download(token, id) {
    const response = await fetch(`${BASE}/attachments/${id}/download`, {
        headers: headers(token),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, bytes };
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
    try {
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
    } catch {
        throw new Error(
            'ffmpeg is required to generate the voice fixture (install ffmpeg or run this script where it exists)',
        );
    }
}

function makeRequestId() {
    return `e2e_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

async function main() {
    const missing = [];
    if (BASE === '') missing.push('URL');
    if (TOKEN_A === '') missing.push('TOKEN_A');
    if (TOKEN_B === '') missing.push('TOKEN_B');
    if (TOKEN_OUT === '') missing.push('TOKEN_OUTSIDER');
    if (!Number.isInteger(CHAT_ID) || CHAT_ID <= 0) missing.push('CHAT_ID');
    if (!Number.isInteger(CHAT_ID_2) || CHAT_ID_2 <= 0) missing.push('CHAT_ID_2');
    if (missing.length > 0) {
        console.error(`Missing/invalid env: ${missing.join(', ')}`);
        process.exit(2);
    }

    const png = await sharp({
        create: { width: 96, height: 72, channels: 3, background: '#2196F3' },
    })
        .png()
        .toBuffer();
    const voice = makeVoice();
    const photoFile = { buffer: png, name: 'forward.png', type: 'image/png' };
    const voiceFile = { buffer: voice, name: 'forward.m4a', type: 'audio/mp4' };

    const socketA = await connect(TOKEN_A);
    const socketB = await connect(TOKEN_B);
    const socketOut = await connect(TOKEN_OUT);
    try {
        check((await request(socketA, 'joinChat', { chatId: CHAT_ID })).ok, 'A join 1');
        check((await request(socketA, 'joinChat', { chatId: CHAT_ID_2 })).ok, 'A join 2');
        check((await request(socketB, 'joinChat', { chatId: CHAT_ID_2 })).ok, 'B join 2');

        // --- fixtures -----------------------------------------------------
        const photo = await upload(TOKEN_A, CHAT_ID, [photoFile]);
        check(photo.body?.ok === true, `photo upload: ${JSON.stringify(photo.body)}`);
        const voiceUpload = await upload(TOKEN_A, CHAT_ID, [voiceFile], true);
        check(
            voiceUpload.body?.ok === true && voiceUpload.body.data[0].kind === 'voice',
            `voice upload: ${JSON.stringify(voiceUpload.body)}`,
        );

        const textAck = await request(socketA, 'sendMessage', {
            chatId: CHAT_ID,
            content: `forward-e2e-${Date.now()}`,
            clientMessageId: `c_${Date.now().toString(36)}`,
        });
        check(textAck.ok === true, `text send: ${JSON.stringify(textAck)}`);
        const photoAck = await request(socketA, 'sendMessage', {
            chatId: CHAT_ID,
            content: '',
            attachments: [photo.body.data[0].id],
            clientMessageId: `c_${Date.now().toString(36)}p`,
        });
        check(photoAck.ok === true, `photo send: ${JSON.stringify(photoAck)}`);
        const voiceAck = await request(socketA, 'sendMessage', {
            chatId: CHAT_ID,
            content: '',
            attachments: [voiceUpload.body.data[0].id],
            clientMessageId: `c_${Date.now().toString(36)}v`,
        });
        check(voiceAck.ok === true, `voice send: ${JSON.stringify(voiceAck)}`);

        const sources = [textAck.data, photoAck.data, voiceAck.data].sort(
            (a, b) => Number(a.id) - Number(b.id),
        );
        const sourceIds = sources.map((message) => Number(message.id));

        let forwarded = null;
        await test('A forwards text + photo + voice in order; B receives 3 echoes', async () => {
            const echoPromise = waitForMany(
                socketB,
                'sendMessage:list',
                (message) =>
                    Number(message.senderId) === Number(sources[0].senderId) &&
                    message.forwardedFrom !== null,
                3,
            );
            const ack = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [...sourceIds].reverse(),
                toChatIds: [CHAT_ID_2],
                requestId: makeRequestId(),
            });
            check(ack.ok === true, `ack: ${JSON.stringify(ack)}`);
            const result = ack.data.results;
            check(result.length === 1 && result[0].ok === true, 'one successful target');
            check(
                JSON.stringify(result[0].messageIds) !== '[]' &&
                    result[0].messageIds.length === 3,
                'three created ids',
            );
            const echoes = await echoPromise;
            const sorted = [...echoes].sort((a, b) => Number(a.id) - Number(b.id));
            check(
                JSON.stringify(sorted.map((m) => Number(m.id))) ===
                    JSON.stringify(result[0].messageIds.map(Number)),
                'echo ids match ack ids in order',
            );
            check(
                JSON.stringify(sorted.map((m) => m.content)) ===
                    JSON.stringify(sources.map((m) => m.content)),
                'content order preserved',
            );
            check(
                sorted[1].attachments[0].kind === 'image' &&
                    sorted[2].attachments[0].kind === 'voice',
                'attachment kinds preserved',
            );
            check(
                sorted[2].attachments[0].duration !== undefined &&
                    Array.isArray(sorted[2].attachments[0].waveform),
                'voice metadata preserved',
            );
            check(
                sorted.every(
                    (m) =>
                        Number(m.forwardedFrom.userId) ===
                            Number(sources[0].senderId) &&
                        m.forwardedFrom.name === sources[0].sender.name,
                ),
                'forwardedFrom points at the original sender',
            );
            check(
                sorted.every(
                    (m) =>
                        m.attachments.every(
                            (a) =>
                                !sourceIds.includes(Number(a.id)) &&
                                !('storageKey' in a),
                        ),
                ),
                'attachments are new rows with no storage key',
            );
            check(
                !JSON.stringify(ack).includes('fromChatId') &&
                    !JSON.stringify(sorted).includes(`"sourceChatId"`),
                'source chat metadata leaked',
            );
            forwarded = sorted;
        });

        await test('forwarded attachment bytes match the original (SHA-256)', async () => {
            const originalPhoto = await download(TOKEN_B, photo.body.data[0].id);
            const copyPhoto = await download(
                TOKEN_B,
                forwarded[1].attachments[0].id,
            );
            check(copyPhoto.status === 200, `photo copy ${copyPhoto.status}`);
            check(sha256(copyPhoto.bytes) === sha256(originalPhoto.bytes), 'photo bytes');
            const originalVoice = await download(
                TOKEN_B,
                voiceUpload.body.data[0].id,
            );
            const copyVoice = await download(
                TOKEN_B,
                forwarded[2].attachments[0].id,
            );
            check(copyVoice.status === 200, `voice copy ${copyVoice.status}`);
            check(sha256(copyVoice.bytes) === sha256(originalVoice.bytes), 'voice bytes');
        });

        await test('forwarding a forwarded message keeps the first origin', async () => {
            const ack = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID_2,
                messageIds: [forwarded[0].id],
                toChatIds: [CHAT_ID],
                requestId: makeRequestId(),
            });
            check(ack.ok === true, `ack: ${JSON.stringify(ack)}`);
            const copyId = ack.data.results[0].messageIds[0];
            const page = await request(socketA, 'getMessages', {
                chatId: CHAT_ID,
                limit: 20,
            });
            const copy = page.data.messages.find((m) => Number(m.id) === Number(copyId));
            check(copy !== undefined, 'copy not in source history');
            check(
                JSON.stringify(copy.forwardedFrom) ===
                    JSON.stringify(forwarded[0].forwardedFrom),
                'origin changed on re-forward',
            );
        });

        await test('outsider cannot forward from or to a chat they are not in', async () => {
            const fromSource = await request(socketOut, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [sourceIds[0]],
                toChatIds: [CHAT_ID_2],
                requestId: makeRequestId(),
            });
            check(fromSource.ok !== true, 'outsider forwarded from a foreign chat');
            const toTarget = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [sourceIds[0]],
                toChatIds: [CHAT_ID_2],
                requestId: makeRequestId(),
            });
            check(toTarget.ok === true, `unexpected: ${JSON.stringify(toTarget)}`);
            const outsiderTarget = await request(socketOut, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [sourceIds[0]],
                toChatIds: [CHAT_ID_2],
                requestId: makeRequestId(),
            });
            check(outsiderTarget.ok !== true, 'outsider forwarded to a foreign chat');
        });

        await test('one unauthorized target fails alone', async () => {
            const ack = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [sourceIds[1]],
                toChatIds: [CHAT_ID_2, 999999999],
                requestId: makeRequestId(),
            });
            check(ack.ok === true, `whole request failed: ${JSON.stringify(ack)}`);
            const results = ack.data.results;
            check(results.length === 2, 'expected two target results');
            check(
                results.some((row) => row.chatId === CHAT_ID_2 && row.ok === true),
                'valid target did not succeed',
            );
            check(
                results.some((row) => row.ok === false),
                'invalid target did not fail alone',
            );
        });

        await test('deleted or foreign ids reject the whole request', async () => {
            const del = await request(socketA, 'deleteMessage', {
                chatId: CHAT_ID,
                messageId: sourceIds[0],
            });
            check(del.ok === true, `delete: ${JSON.stringify(del)}`);
            const deleted = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [sourceIds[0]],
                toChatIds: [CHAT_ID_2],
                requestId: makeRequestId(),
            });
            check(deleted.ok === false, 'deleted id accepted');
            const foreign = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [forwarded[0].id],
                toChatIds: [CHAT_ID_2],
                requestId: makeRequestId(),
            });
            check(foreign.ok === false, 'foreign id accepted');
        });

        await test('21 messages and 6 targets are rejected', async () => {
            const tooManyMessages = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: Array.from({ length: 21 }, (_, i) => i + 1),
                toChatIds: [CHAT_ID_2],
                requestId: makeRequestId(),
            });
            check(tooManyMessages.ok === false, '21 messages accepted');
            const tooManyTargets = await request(socketA, 'forwardMessages', {
                fromChatId: CHAT_ID,
                messageIds: [sourceIds[1]],
                toChatIds: [1, 2, 3, 4, 5, 6],
                requestId: makeRequestId(),
            });
            check(tooManyTargets.ok === false, '6 targets accepted');
        });

        await test('same requestId creates once and returns the same result', async () => {
            const requestId = makeRequestId();
            const payload = {
                fromChatId: CHAT_ID,
                messageIds: [sourceIds[1]],
                toChatIds: [CHAT_ID_2],
                requestId,
            };
            const first = await request(socketA, 'forwardMessages', payload);
            const second = await request(socketA, 'forwardMessages', payload);
            check(first.ok && second.ok, 'idempotent retry failed');
            check(
                JSON.stringify(first.data) === JSON.stringify(second.data),
                'stored result differs',
            );
            const page = await request(socketA, 'getMessages', {
                chatId: CHAT_ID_2,
                limit: 100,
            });
            const copies = page.data.messages.filter((m) =>
                first.data.results[0].messageIds.includes(Number(m.id)),
            );
            check(copies.length === 1, `expected one copy, found ${copies.length}`);
        });

        await test('editMessage on a forwarded message is rejected', async () => {
            const ack = await request(socketA, 'editMessage', {
                messageId: forwarded[0].id,
                chatId: CHAT_ID_2,
                newContent: 'edited',
            });
            check(ack.ok === false, 'forwarded message was editable');
            check(/forwarded/i.test(ack.message ?? ''), `message: ${ack.message}`);
        });

        await test('deleting the original keeps the forwarded copy downloadable', async () => {
            const del = await request(socketA, 'deleteMessage', {
                chatId: CHAT_ID,
                messageId: sourceIds[1],
            });
            check(del.ok === true, `delete photo: ${JSON.stringify(del)}`);
            // If a short cleanup interval is configured, wait for the cleanup
            // pass; either way the hard-linked copy must remain downloadable.
            if (CLEANUP_WAIT_MS > 0) await sleep(CLEANUP_WAIT_MS);
            const copy = await download(TOKEN_B, forwarded[1].attachments[0].id);
            check(copy.status === 200, `copy download ${copy.status}`);
            check(sha256(copy.bytes) === sha256(png), 'copy bytes changed');
        });

        await test('rate limit rejects the 21st request and later recovers', async () => {
            let limitedAt = null;
            for (let i = 0; i < 21; i += 1) {
                const ack = await request(socketB, 'forwardMessages', {
                    fromChatId: CHAT_ID_2,
                    messageIds: [999999999],
                    toChatIds: [CHAT_ID],
                    requestId: makeRequestId(),
                });
                if (ack.ok === false && /too many/i.test(ack.message ?? '')) {
                    limitedAt = i + 1;
                    break;
                }
            }
            check(limitedAt === 21, `rate limit hit at ${limitedAt}, expected 21`);
            if (RATE_LIMIT_WAIT_MS > 0) {
                await sleep(RATE_LIMIT_WAIT_MS);
                const recovered = await request(socketB, 'forwardMessages', {
                    fromChatId: CHAT_ID_2,
                    messageIds: [forwarded[1].id],
                    toChatIds: [CHAT_ID],
                    requestId: makeRequestId(),
                });
                check(recovered.ok === true, 'rate limit did not recover');
            } else {
                skip(
                    'rate-limit recovery wait',
                    'set RATE_LIMIT_WAIT_MS (e.g. 61000) to exercise it',
                );
            }
        });
    } finally {
        socketA.close();
        socketB.close();
        socketOut.close();
    }

    console.log(
        `\n${passed} passed, ${failed} failed, ${skipped} skipped`,
    );
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
