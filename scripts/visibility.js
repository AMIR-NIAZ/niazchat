#!/usr/bin/env node
/*
 * End-to-end visibility checks (docs/mobile-api/visibility.md).
 *
 * Env:
 *   URL                API origin (default http://localhost:3000)
 *   TOKEN_A            viewer whose profile/chat/group access is restricted
 *   TOKEN_B            user who blocks A (private chat with A)
 *   TOKEN_C            group owner/admin who bans A (ban_users permission)
 *   PRIVATE_CHAT_ID    existing private chat between A and B
 *   GROUP_CHAT_ID      existing group containing A and C
 *
 * Optional:
 *   GROUP_INVITE_CODE  an active invite code for GROUP_CHAT_ID (link-preview check)
 *
 * Flow: B blocks A → profile/search/peer/sender sanitization + refused send →
 * B unblocks A → everything restored. Then C bans A in the group → info,
 * members and invite preview are 403, the group is gone from A's chat list →
 * C unbans A. Prints PASS/FAIL lines; exit code 1 on any failure.
 */

/* eslint-disable no-console */
const { io } = require('socket.io-client');

const BASE = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A;
const TOKEN_B = process.env.TOKEN_B;
const TOKEN_C = process.env.TOKEN_C;
const PRIVATE_CHAT_ID = Number(process.env.PRIVATE_CHAT_ID);
const GROUP_CHAT_ID = Number(process.env.GROUP_CHAT_ID);
const GROUP_INVITE_CODE = process.env.GROUP_INVITE_CODE;

if (
    !TOKEN_A ||
    !TOKEN_B ||
    !TOKEN_C ||
    !Number.isInteger(PRIVATE_CHAT_ID) ||
    PRIVATE_CHAT_ID <= 0 ||
    !Number.isInteger(GROUP_CHAT_ID) ||
    GROUP_CHAT_ID <= 0
) {
    console.error(
        'Missing env: TOKEN_A, TOKEN_B, TOKEN_C, PRIVATE_CHAT_ID and GROUP_CHAT_ID are required.',
    );
    process.exit(1);
}

let failures = 0;
let skipped = 0;

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`PASS ${name}`);
    } else {
        failures += 1;
        console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function skip(name, reason) {
    skipped += 1;
    console.log(`SKIP ${name} — ${reason}`);
}

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
    const response = await fetch(`${BASE}${path}`, { method, headers, body });
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
                        (response && response.message) || `${event} failed`,
                    ),
                );
        });
    });
}

/** Resolves `{ status, message }` for a send the server is expected to reject. */
function sendExpectation(socket, payload) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(
            () => finish({ status: 0, message: 'timeout' }),
            8000,
        );
        socket.emit('sendMessage', payload, (response) => {
            finish({
                status:
                    response && response.ok === true
                        ? 200
                        : (response?.status ?? 0),
                message: response?.message ?? '',
            });
        });
    });
}

function chatPeer(chats, chatId) {
    return (chats ?? []).find((row) => Number(row.id) === Number(chatId))?.peer;
}

function findMessageSender(messages, senderId) {
    return (messages ?? []).find(
        (message) => Number(message.senderId) === Number(senderId),
    )?.sender;
}

async function main() {
    const aId = decodeUserId(TOKEN_A);
    const bId = decodeUserId(TOKEN_B);
    const cId = decodeUserId(TOKEN_C);

    console.log(`Visibility E2E against ${BASE}`);

    const sockets = {};
    try {
        sockets.a = await connect(TOKEN_A);
        sockets.b = await connect(TOKEN_B);
        sockets.c = await connect(TOKEN_C);
    } catch (error) {
        console.error(`FAIL could not connect sockets — ${error.message}`);
        process.exit(1);
    }

    let groupMemberRow = null;
    try {
        // ── baseline ───────────────────────────────────────────────────────
        const beforeProfile = await api('GET', `/user/${bId}/profile`, {
            token: TOKEN_A,
        });
        check(
            'A can read B before the block',
            beforeProfile.status === 200,
            `status ${beforeProfile.status}`,
        );
        const bUsername = beforeProfile.body?.username ?? null;
        const bAvatarsBefore = Array.isArray(beforeProfile.body?.avatars)
            ? beforeProfile.body.avatars
            : [];

        const beforeChats = (await wsRequest(sockets.a, 'getAllChats')) ?? [];
        const peerBefore = chatPeer(beforeChats, PRIVATE_CHAT_ID);
        const peerAvatarsBefore = Array.isArray(peerBefore?.avatars)
            ? peerBefore.avatars
            : [];

        // ── B blocks A ─────────────────────────────────────────────────────
        await wsRequest(sockets.b, 'blockUser', { chatId: PRIVATE_CHAT_ID });
        check('B blocks A over the socket', true);

        const blockedProfile = await api('GET', `/user/${bId}/profile`, {
            token: TOKEN_A,
        });
        check(
            "A gets 404 on B's profile with the generic message",
            blockedProfile.status === 404 &&
                blockedProfile.body?.message === "This profile isn't available",
            `status ${blockedProfile.status} ${blockedProfile.text}`,
        );

        if (typeof bUsername === 'string' && bUsername.length >= 2) {
            const search = await api(
                'GET',
                `/user/search?q=${encodeURIComponent(bUsername.slice(0, 2))}`,
                { token: TOKEN_A },
            );
            const ids = (search.body?.data ?? []).map((row) => Number(row.id));
            check(
                "B never appears in A's user search",
                search.status === 200 && !ids.includes(bId),
                search.text,
            );
        } else {
            skip('user search exclusion', 'B has no username prefix to search');
        }

        const afterChats = (await wsRequest(sockets.a, 'getAllChats')) ?? [];
        const blockedPeer = chatPeer(afterChats, PRIVATE_CHAT_ID);
        check(
            'the private peer exists with its history after the block',
            blockedPeer !== undefined && blockedPeer !== null,
        );
        check(
            'the blocked peer exposes no avatars',
            blockedPeer !== null &&
                Array.isArray(blockedPeer.avatars) &&
                blockedPeer.avatars.length === 0,
            JSON.stringify(blockedPeer?.avatars),
        );
        check(
            'the blocked peer exposes no username',
            blockedPeer !== null &&
                (blockedPeer.username === '' || blockedPeer.username === null),
            String(blockedPeer?.username),
        );
        check(
            'the blocked peer exposes no presence',
            blockedPeer !== null &&
                blockedPeer.isOnline === false &&
                blockedPeer.lastSeen === null,
            JSON.stringify({
                isOnline: blockedPeer?.isOnline,
                lastSeen: blockedPeer?.lastSeen,
            }),
        );

        const chatInfo = await wsRequest(sockets.a, 'joinChat', {
            chatId: PRIVATE_CHAT_ID,
        });
        check(
            'joinChat peer is sanitized for the blocked viewer',
            chatInfo?.peer !== null &&
                Array.isArray(chatInfo?.peer?.avatars) &&
                chatInfo.peer.avatars.length === 0,
            JSON.stringify(chatInfo?.peer),
        );

        const history = await wsRequest(sockets.a, 'getMessages', {
            chatId: PRIVATE_CHAT_ID,
            limit: 30,
        });
        const sender = findMessageSender(history?.messages, bId);
        if (sender !== undefined) {
            check(
                'history sender B has no avatar for A',
                Array.isArray(sender.avatars) && sender.avatars.length === 0,
                JSON.stringify(sender.avatars),
            );
            check(
                'history sender B has no username for A',
                sender.username === '' || sender.username === null,
                String(sender.username),
            );
        } else {
            skip(
                'history sender sanitization',
                'the private chat has no message from B',
            );
        }

        const refused = await sendExpectation(sockets.a, {
            chatId: PRIVATE_CHAT_ID,
            content: `visibility-blocked-${Date.now()}`,
            type: 'text',
        });
        check(
            'A cannot send a message to B (403)',
            refused.status === 403,
            `${refused.status} ${refused.message}`,
        );

        const bSeesA = await api('GET', `/user/${aId}/profile`, {
            token: TOKEN_B,
        });
        check(
            'B still sees A normally (blocking is one-way)',
            bSeesA.status === 200,
            `status ${bSeesA.status}`,
        );

        // ── unblock restores everything ────────────────────────────────────
        await wsRequest(sockets.b, 'unblockUser', { chatId: PRIVATE_CHAT_ID });
        const restoredProfile = await api('GET', `/user/${bId}/profile`, {
            token: TOKEN_A,
        });
        check(
            'unblocking restores the profile',
            restoredProfile.status === 200,
            `status ${restoredProfile.status}`,
        );
        const restoredChats = (await wsRequest(sockets.a, 'getAllChats')) ?? [];
        const restoredPeer = chatPeer(restoredChats, PRIVATE_CHAT_ID);
        check(
            'unblocking restores the peer avatars',
            JSON.stringify(restoredPeer?.avatars ?? []) ===
                JSON.stringify(peerAvatarsBefore) ||
                peerAvatarsBefore.length === 0,
            JSON.stringify(restoredPeer?.avatars),
        );
        check(
            'unblocking restores the peer username',
            (restoredPeer?.username ?? '') === (peerBefore?.username ?? ''),
            String(restoredPeer?.username),
        );
        const restoredSend = await sendExpectation(sockets.a, {
            chatId: PRIVATE_CHAT_ID,
            content: `visibility-restored-${Date.now()}`,
            type: 'text',
        });
        check(
            'A can send to B again after the unblock',
            restoredSend.status === 200,
            `${restoredSend.status} ${restoredSend.message}`,
        );
        if (bAvatarsBefore.length > 0) {
            check(
                'B profile avatars are restored for A',
                Array.isArray(restoredProfile.body?.avatars) &&
                    restoredProfile.body.avatars.length > 0,
            );
        }

        // ── group admin bans A ─────────────────────────────────────────────
        const members = await api(
            'GET',
            `/chats/${GROUP_CHAT_ID}/members?limit=100`,
            { token: TOKEN_C },
        );
        groupMemberRow = (members.body?.items ?? []).find(
            (row) => Number(row.userId) === aId,
        );
        check(
            'C can read the members list and finds A',
            members.status === 200 && groupMemberRow !== undefined,
            members.text,
        );
        if (groupMemberRow === undefined) {
            console.log("cannot continue group checks without A's member row");
        } else {
            let inviteCode = GROUP_INVITE_CODE;
            if (inviteCode === undefined) {
                const link = await api(
                    'POST',
                    `/chats/${GROUP_CHAT_ID}/invite-links`,
                    { token: TOKEN_C, body: {} },
                );
                if (link.status < 300 && typeof link.body?.code === 'string') {
                    inviteCode = link.body.code;
                }
            }

            const ban = await api(
                'POST',
                `/chats/${GROUP_CHAT_ID}/members/${groupMemberRow.memberId}/ban`,
                { token: TOKEN_C },
            );
            check(
                'C bans A from the group',
                ban.status === 200,
                `${ban.status} ${ban.text}`,
            );

            const info = await api('GET', `/chats/${GROUP_CHAT_ID}/group`, {
                token: TOKEN_A,
            });
            check(
                'A gets 403 on the group info and it carries no profile data',
                info.status === 403 &&
                    info.body?.message === "You can't access this group" &&
                    info.body?.title === undefined &&
                    info.body?.avatars === undefined &&
                    info.body?.membersCount === undefined,
                `${info.status} ${info.text}`,
            );

            const bannedMembers = await api(
                'GET',
                `/chats/${GROUP_CHAT_ID}/members`,
                { token: TOKEN_A },
            );
            check(
                'A gets 403 on the members list',
                bannedMembers.status === 403,
                `${bannedMembers.status} ${bannedMembers.text}`,
            );

            const bannedChats =
                (await wsRequest(sockets.a, 'getAllChats')) ?? [];
            check(
                "the group is gone from A's chat list",
                bannedChats.every((row) => Number(row.id) !== GROUP_CHAT_ID),
            );

            if (typeof inviteCode === 'string') {
                const preview = await api('GET', `/invites/${inviteCode}`, {
                    token: TOKEN_A,
                });
                check(
                    'A gets 403 on the invite preview with no group data',
                    preview.status === 403 &&
                        preview.body?.title === undefined &&
                        preview.body?.avatar === undefined &&
                        preview.body?.membersCount === undefined,
                    `${preview.status} ${preview.text}`,
                );
            } else {
                skip('invite preview 403', 'no invite code was available');
            }

            // The owner still sees the group normally.
            const creatorView = await api(
                'GET',
                `/chats/${GROUP_CHAT_ID}/group`,
                { token: TOKEN_C },
            );
            check(
                'C keeps full access to the group',
                creatorView.status === 200 &&
                    Array.isArray(creatorView.body?.avatars),
                `status ${creatorView.status}`,
            );

            // ── unban restores access ──────────────────────────────────────
            const unban = await api(
                'POST',
                `/chats/manage/onban/${groupMemberRow.memberId}`,
                { token: TOKEN_C },
            );
            const restoredInfo = await api(
                'GET',
                `/chats/${GROUP_CHAT_ID}/group`,
                { token: TOKEN_A },
            );
            check(
                'unbanning restores the group info for A',
                unban.status === 200 && restoredInfo.status === 200,
                `${unban.status}/${restoredInfo.status}`,
            );
            groupMemberRow = null;
        }

        // Private chat left unblocked above; group membership restored.
    } finally {
        for (const socket of Object.values(sockets)) socket.close();
        if (groupMemberRow !== null) {
            // Best effort: never leave the fixture group broken on a failure.
            await api(
                'POST',
                `/chats/manage/onban/${groupMemberRow.memberId}`,
                { token: TOKEN_C },
            ).catch(() => undefined);
        }
    }

    if (failures > 0) {
        console.log(
            `\n${failures} check(s) failed${skipped > 0 ? `, ${skipped} skipped` : ''}`,
        );
        process.exit(1);
    }
    console.log(
        `\nAll visibility checks passed${skipped > 0 ? ` (${skipped} skipped)` : ''}`,
    );
    process.exit(0);
}

main().catch((error) => {
    console.error(`FAIL unexpected error — ${error.stack || error.message}`);
    process.exit(1);
});
