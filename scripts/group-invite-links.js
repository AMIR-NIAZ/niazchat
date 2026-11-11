#!/usr/bin/env node
/*
 * End-to-end check for group invite links (docs/mobile-api/groups.md).
 *
 * Required env:
 *   URL              API origin (default http://localhost:3000)
 *   TOKEN_OWNER      owner token
 *   TOKEN_ADMIN      token of a user who will be promoted to admin
 *   TOKEN_MEMBER     regular member token
 *   TOKEN_OUTSIDER   user who is NOT in the group
 * Optional:
 *   TOKEN_BANNED         user used for the banned-rejoin checks
 *   TOKENS_EXTRA         comma-separated extra user tokens (maxUses race; >= 2)
 *
 * The script creates its own groups through the normal API, promotes the admin
 * through the panel endpoint, and prints PASS/FAIL lines. Exit code 1 on any
 * failure. No dependency beyond the project's socket.io-client.
 *
 * An expired-link assertion cannot be produced over HTTP within a minute
 * (the smallest allowed expiry is one hour); the unit test covers the server
 * clock. It is reported as SKIP here.
 */

/* eslint-disable no-console */
const { io } = require('socket.io-client');

const BASE = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = {
    owner: process.env.TOKEN_OWNER,
    admin: process.env.TOKEN_ADMIN,
    member: process.env.TOKEN_MEMBER,
    outsider: process.env.TOKEN_OUTSIDER,
    banned: process.env.TOKEN_BANNED || null,
};
const EXTRA_TOKENS = (process.env.TOKENS_EXTRA || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

if (!TOKEN.owner || !TOKEN.admin || !TOKEN.member || !TOKEN.outsider) {
    console.error(
        'Missing env: TOKEN_OWNER, TOKEN_ADMIN, TOKEN_MEMBER and TOKEN_OUTSIDER are required.',
    );
    process.exit(1);
}

let failures = 0;

function pass(label, detail = '') {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
    failures += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function check(condition, label, detail = '') {
    if (condition) pass(label, detail);
    else fail(label, detail);
    return Boolean(condition);
}

function skip(label, reason) {
    console.log(`SKIP ${label} — ${reason}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeUserId(token) {
    const part = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return Number(payload.sub ?? payload.userId ?? payload.id);
}

function messageOf(body) {
    if (body === null || body === undefined) return '';
    return Array.isArray(body.message)
        ? body.message.join('; ')
        : String(body.message ?? '');
}

async function api(method, path, token, body) {
    const headers = { authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const response = await fetch(`${BASE}${path}`, init);
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

function collector(socket, event) {
    const items = [];
    const handler = (payload) => items.push(payload);
    socket.on(event, handler);
    return {
        wait: (predicate, timeoutMs = 6000) =>
            new Promise((resolve, reject) => {
                const started = Date.now();
                const tick = () => {
                    const found = items.find(predicate);
                    if (found !== undefined) {
                        resolve(found);
                        return;
                    }
                    if (Date.now() - started >= timeoutMs) {
                        reject(new Error(`timed out waiting for ${event}`));
                        return;
                    }
                    setTimeout(tick, 100);
                };
                tick();
            }),
    };
}

async function createGroup(token, title) {
    const response = await api('POST', '/chats/create', token, { title });
    return response;
}

async function allChats(socket) {
    return (await wsRequest(socket, 'getAllChats')) ?? [];
}

async function findGroup(socket, title) {
    const chats = await allChats(socket);
    return chats.find(
        (chat) => chat.title === title && chat.type === 'groupe',
    );
}

async function createLink(token, chatId, body = {}) {
    return api('POST', `/chats/${chatId}/invite-links`, token, body);
}

async function listLinks(token, chatId) {
    return api('GET', `/chats/${chatId}/invite-links`, token);
}

async function members(token, chatId) {
    return api('GET', `/chats/${chatId}/members?limit=100`, token);
}

async function memberRow(token, chatId, userId) {
    const response = await members(token, chatId);
    return {
        response,
        row: (response.body?.items ?? []).find(
            (item) => Number(item.userId) === Number(userId),
        ),
    };
}

async function main() {
    const ids = {
        owner: decodeUserId(TOKEN.owner),
        admin: decodeUserId(TOKEN.admin),
        member: decodeUserId(TOKEN.member),
        outsider: decodeUserId(TOKEN.outsider),
        banned: TOKEN.banned ? decodeUserId(TOKEN.banned) : null,
    };
    const sockets = {};
    const changes = {};
    const socketTokens = {
        owner: TOKEN.owner,
        admin: TOKEN.admin,
        member: TOKEN.member,
        outsider: TOKEN.outsider,
        ...(TOKEN.banned ? { banned: TOKEN.banned } : {}),
    };

    try {
        for (const [name, token] of Object.entries(socketTokens)) {
            sockets[name] = await connect(token);
            changes[name] = collector(sockets[name], 'group:changed');
        }

        // ── 1. owner creates a group and a link ───────────────────────────
        const title = `Invite ${String(Date.now()).slice(-8)}`;
        check(
            (await createGroup(TOKEN.owner, title)).status < 300,
            'owner creates a test group',
        );
        const group = await findGroup(sockets.owner, title);
        if (!group) {
            fail('created group appears in getAllChats');
            return;
        }
        const chatId = Number(group.id);
        await wsRequest(sockets.owner, 'joinChat', { chatId });

        const infoOwner = await api('GET', `/chats/${chatId}/group`, TOKEN.owner);
        check(
            infoOwner.body?.capabilities?.canManageInviteLinks === true,
            'owner capabilities.canManageInviteLinks = true',
        );

        const created = await createLink(TOKEN.owner, chatId, {});
        const linkA = created.body;
        check(created.status < 300, 'owner creates a link', String(created.status));
        check(
            typeof linkA?.code === 'string' && /^[A-Za-z0-9_-]{22}$/.test(linkA.code),
            'created code is 22 URL-safe characters',
            linkA?.code,
        );
        check(
            linkA?.status === 'active' &&
                linkA?.usesCount === 0 &&
                linkA?.maxUses === null &&
                linkA?.expiresAt === null &&
                linkA?.createdBy?.userId === ids.owner,
            'created link has active status, zero uses and the owner as creator',
        );
        check(
            (await listLinks(TOKEN.owner, chatId)).body?.activeCount === 1,
            'list reports one active link',
        );

        // ── 2. admin joins, is promoted, then manages links ───────────────
        const previewAdmin = await api(
            'GET',
            `/invites/${linkA.code}`,
            TOKEN.admin,
        );
        check(
            previewAdmin.status === 200 &&
                previewAdmin.body?.alreadyMember === false &&
                previewAdmin.body?.chatId === null &&
                typeof previewAdmin.body?.title === 'string',
            'admin previews the link as a non-member',
        );
        check(
            (await api('POST', `/invites/${linkA.code}/join`, TOKEN.admin))
                .body?.joined === true,
            'admin joins through the link',
        );
        await wsRequest(sockets.admin, 'joinChat', { chatId });
        const adminMember = await memberRow(TOKEN.owner, chatId, ids.admin);
        const promoted = await api(
            'POST',
            `/chats/${chatId}/members/${adminMember.row?.memberId}/promote`,
            TOKEN.owner,
        );
        check(
            promoted.status < 300 && promoted.body?.role === 'admin',
            'owner promotes the admin',
        );
        const infoAdmin = await api('GET', `/chats/${chatId}/group`, TOKEN.admin);
        check(
            infoAdmin.body?.capabilities?.canManageInviteLinks === true,
            'admin capabilities.canManageInviteLinks = true',
        );
        check(
            (await createLink(TOKEN.admin, chatId, {})).status < 300,
            'admin creates a link',
        );

        // ── 3. member joins and cannot manage ─────────────────────────────
        check(
            (await api('POST', `/invites/${linkA.code}/join`, TOKEN.member))
                .body?.joined === true,
            'member joins through the link',
        );
        await wsRequest(sockets.member, 'joinChat', { chatId });
        const infoMember = await api('GET', `/chats/${chatId}/group`, TOKEN.member);
        check(
            infoMember.body?.capabilities?.canManageInviteLinks === false,
            'member capabilities.canManageInviteLinks = false',
        );
        check(
            (await createLink(TOKEN.member, chatId, {})).status === 403,
            'member cannot create a link (403)',
        );

        // ── 4. outsider previews and joins; realtime + counts ─────────────
        const before = await listLinks(TOKEN.owner, chatId);
        const beforeUses =
            before.body?.items.find((item) => item.code === linkA.code)
                ?.usesCount ?? null;
        const joinedEvent = changes.owner
            .wait(
                (payload) =>
                    Number(payload.chatId) === chatId &&
                    payload.reason === 'member_joined',
            )
            .catch(() => null);
        const membersBefore = infoMember.body?.membersCount ?? 0;
        const outsiderJoin = await api(
            'POST',
            `/invites/${linkA.code}/join`,
            TOKEN.outsider,
        );
        check(
            outsiderJoin.status < 300 &&
                outsiderJoin.body?.joined === true &&
                outsiderJoin.body?.alreadyMember === false,
            'outsider joins through the link',
        );
        const event = await joinedEvent;
        check(
            event !== null,
            'room receives group:changed member_joined',
        );
        const outsiderChats = await allChats(sockets.outsider);
        check(
            outsiderChats.some((chat) => Number(chat.id) === chatId),
            "joined user's getAllChats contains the group",
        );
        const outsiderRow = await memberRow(TOKEN.owner, chatId, ids.outsider);
        check(
            outsiderRow.row?.role === 'member',
            'new member appears in the members list with role member',
        );
        const infoAfter = await api('GET', `/chats/${chatId}/group`, TOKEN.owner);
        check(
            infoAfter.body?.membersCount === membersBefore + 1,
            'membersCount increases after a join',
        );
        const after = await listLinks(TOKEN.owner, chatId);
        const afterUses =
            after.body?.items.find((item) => item.code === linkA.code)
                ?.usesCount ?? null;
        check(
            Number(afterUses) === Number(beforeUses) + 1,
            'usesCount increments once for a new member',
            `${beforeUses} → ${afterUses}`,
        );
        const again = await api(
            'POST',
            `/invites/${linkA.code}/join`,
            TOKEN.outsider,
        );
        check(
            again.body?.alreadyMember === true && again.body?.joined === false,
            'joining again answers alreadyMember and does not re-add',
        );
        const afterAgain = await listLinks(TOKEN.owner, chatId);
        check(
            afterAgain.body?.items.find((item) => item.code === linkA.code)
                ?.usesCount === afterUses,
            'joining again does not consume a use',
        );
        await wsRequest(sockets.outsider, 'joinChat', { chatId });

        // ── 5. allowlists ─────────────────────────────────────────────────
        check(
            (await createLink(TOKEN.owner, chatId, {
                expiresInSeconds: 123,
            })).status === 400,
            'invalid expiresInSeconds → 400',
        );
        check(
            (await createLink(TOKEN.owner, chatId, { maxUses: 3 })).status ===
                400,
            'invalid maxUses → 400',
        );

        // ── 6. same-chat revoke and the 10-active limit ───────────────────
        const secondTitle = `${title}b`;
        await createGroup(TOKEN.owner, secondTitle);
        const secondGroup = await findGroup(sockets.owner, secondTitle);
        const secondId = Number(secondGroup?.id);
        const secondLink = (
            await createLink(TOKEN.owner, secondId, {})
        ).body;
        const foreignRevoke = await api(
            'DELETE',
            `/chats/${chatId}/invite-links/${secondLink?.id}`,
            TOKEN.owner,
        );
        check(
            foreignRevoke.status === 404,
            'revoking a link id from another chat → 404',
            String(foreignRevoke.status),
        );
        const secondList = await listLinks(TOKEN.owner, secondId);
        check(
            secondList.body?.items.find(
                (item) => item.id === secondLink?.id,
            )?.status === 'active',
            "the other chat's link stays active",
        );

        for (let index = 0; index < 9; index += 1) {
            await createLink(TOKEN.owner, secondId, {});
        }
        const capped = await createLink(TOKEN.owner, secondId, {});
        check(
            capped.status === 409 &&
                messageOf(capped.body).includes(
                    'Too many active invite links',
                ),
            'the 11th active link → 409',
            `${capped.status} ${messageOf(capped.body)}`,
        );
        const cappedList = await listLinks(TOKEN.owner, secondId);
        check(
            cappedList.body?.activeCount === 10 &&
                cappedList.body?.maxActive === 10,
            'exactly 10 active links are reported',
        );
        const one = cappedList.body?.items?.[0];
        check(
            (await api(
                'DELETE',
                `/chats/${secondId}/invite-links/${one?.id}`,
                TOKEN.owner,
            )).body?.changed === true,
            'revoking an active link answers changed: true',
        );
        check(
            (await createLink(TOKEN.owner, secondId, {})).status < 300,
            'a new link can be created after revoking one',
        );

        // ── 7. banned user can never join ─────────────────────────────────
        if (TOKEN.banned) {
            check(
                (await api('POST', `/invites/${linkA.code}/join`, TOKEN.banned))
                    .body?.joined === true,
                'future-banned user joins once',
            );
            const bannedRow = await memberRow(
                TOKEN.owner,
                chatId,
                ids.banned,
            );
            check(
                (await api(
                    'POST',
                    `/chats/manage/ban/${bannedRow.row?.memberId}`,
                    TOKEN.owner,
                )).status < 300,
                'owner bans the member',
            );
            check(
                (await api('GET', `/invites/${linkA.code}`, TOKEN.banned))
                    .status === 403,
                'banned user preview → 403',
            );
            check(
                (await api(
                    'POST',
                    `/invites/${linkA.code}/join`,
                    TOKEN.banned,
                )).status === 403,
                'banned user join → 403',
            );
            check(
                (await api(
                    'POST',
                    `/chats/join/${linkA.code}`,
                    TOKEN.banned,
                )).status === 403,
                'banned user cannot re-join through the legacy route',
            );
        } else {
            skip('banned-user join checks', 'TOKEN_BANNED not provided');
        }

        // ── 8. revoke keeps members and invalidates the link ──────────────
        const revokeA = await api(
            'DELETE',
            `/chats/${chatId}/invite-links/${linkA.id}`,
            TOKEN.admin,
        );
        check(
            revokeA.status < 300 && revokeA.body?.changed === true,
            'admin revokes a link',
        );
        check(
            (await api(
                'DELETE',
                `/chats/${chatId}/invite-links/${linkA.id}`,
                TOKEN.admin,
            )).body?.changed === false,
            'revoking again is idempotent (changed: false)',
        );
        const revokedList = await listLinks(TOKEN.admin, chatId);
        check(
            revokedList.body?.items.find((item) => item.id === linkA.id)
                ?.status === 'revoked',
            'revoked link is listed with status revoked',
        );
        const invalid = await api(
            'GET',
            `/invites/${linkA.code}`,
            TOKEN.member,
        );
        check(
            invalid.status === 404 &&
                messageOf(invalid.body) ===
                    'This invite link is invalid or has expired',
            'a revoked link returns the generic 404',
        );
        const stillMembers = await members(TOKEN.admin, chatId);
        check(
            stillMembers.body?.items?.some(
                (item) => Number(item.userId) === ids.outsider,
            ),
            'revoking keeps members who already joined',
        );

        // ── 9. maxUses race ───────────────────────────────────────────────
        if (EXTRA_TOKENS.length >= 2) {
            const oneUse = (
                await createLink(TOKEN.owner, chatId, { maxUses: 1 })
            ).body;
            const results = await Promise.all(
                EXTRA_TOKENS.slice(0, 2).map((token) =>
                    api('POST', `/invites/${oneUse.code}/join`, token),
                ),
            );
            const admitted = results.filter(
                (result) =>
                    result.status < 300 && result.body?.joined === true,
            );
            check(
                admitted.length === 1,
                'maxUses: 1 admits exactly one of two concurrent joiners',
                results.map((result) => String(result.status)).join(','),
            );
            const uses = (
                await listLinks(TOKEN.admin, chatId)
            ).body?.items.find((item) => item.id === oneUse.id)?.usesCount;
            check(uses === 1, 'the one-use link records exactly one use');
        } else {
            skip(
                'maxUses concurrency',
                'provide two or more tokens in TOKENS_EXTRA',
            );
        }

        // ── 10. legacy routes delegate to the clean service ───────────────
        const legacyCreate = await api(
            'POST',
            `/chats/manage/${chatId}/link`,
            TOKEN.admin,
            { chatId },
        );
        check(
            legacyCreate.status < 300 &&
                typeof legacyCreate.body?.code === 'string' &&
                legacyCreate.body.code.length === 22,
            'legacy create route answers a new-shape 22-char link',
        );
        check(
            (await api(
                'GET',
                `/chats/manage/${chatId}/link`,
                TOKEN.admin,
            )).status < 300,
            'legacy list route works',
        );
        check(
            (await api(
                'DELETE',
                `/chats/manage/${chatId}/link/${legacyCreate.body?.id}`,
                TOKEN.admin,
            )).status < 300,
            'legacy revoke route works',
        );
        const malformed = await api(
            'POST',
            `/chats/join/${'deadbeef'.repeat(4)}`,
            TOKEN.member,
        );
        check(
            malformed.status === 404 &&
                messageOf(malformed.body) ===
                    'This invite link is invalid or has expired',
            'legacy join with a malformed code → generic 404',
        );

        // ── 11. private chats can never manage links ──────────────────────
        const privateChat = await api('POST', '/chats/private', TOKEN.owner, {
            userId: ids.admin,
        });
        const privateId = Number(
            privateChat.body?.chatId ?? privateChat.body?.id,
        );
        if (Number.isInteger(privateId) && privateId > 0) {
            const privateManage = await api(
                'GET',
                `/chats/${privateId}/invite-links`,
                TOKEN.owner,
            );
            check(
                privateManage.status === 400 &&
                    messageOf(privateManage.body).includes(
                        'only available in groups',
                    ),
                'private chat manage endpoint → 400 group-only',
            );
        } else {
            skip('private chat manage 400', 'private chat id not returned');
        }

        // ── 12. rate limit and recovery ───────────────────────────────────
        let limited = 0;
        for (let index = 0; index < 40; index += 1) {
            const response = await api(
                'POST',
                `/invites/${linkA.code}/join`,
                TOKEN.member,
            );
            if (response.status === 429) limited += 1;
        }
        check(limited > 0, 'rapid joins eventually answer 429', String(limited));
        console.log('Waiting 61s for the rate-limit window to reset…');
        await sleep(61_000);
        const recovered = await api(
            'POST',
            `/invites/${linkA.code}/join`,
            TOKEN.member,
        );
        check(
            recovered.status !== 429,
            'the join rate limit recovers after the window',
            String(recovered.status),
        );

        skip(
            'expired-link live assertion',
            'smallest allowed expiry is 1 hour; covered by the service unit test',
        );
    } catch (error) {
        fail('unexpected error', error && error.message ? error.message : String(error));
    } finally {
        for (const socket of Object.values(sockets)) {
            socket.close();
        }
    }
}

main().then(() => {
    if (failures > 0) {
        console.error(`\n${failures} assertion(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll invite-link assertions passed.');
});
