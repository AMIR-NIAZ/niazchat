#!/usr/bin/env node
/**
 * Group admin permissions end-to-end check (HTTP + Socket.IO).
 *
 * Required env:
 *   URL, TOKEN_OWNER, TOKEN_ADMIN, TOKEN_ADMIN2, TOKEN_MEMBER
 *
 * The script creates its own group, so it needs no existing fixtures. Each
 * account's phone comes from `GET /auth/getme`. Every assertion prints
 * PASS/FAIL; any failure exits non-zero.
 *
 * Covers: legacy normalization, each active permission allowing/denying its
 * action, `manage_messages` implication, promotedById promote/demote rules,
 * grant-subset, owner-only `all`, unknown key → 400, owner untouchable,
 * `group:changed`, and per-role capabilities.
 */
'use strict';

const { io } = require('socket.io-client');

const URL = required('URL').replace(/\/+$/, '');
const TOKEN = {
    owner: required('TOKEN_OWNER'),
    admin: required('TOKEN_ADMIN'),
    admin2: required('TOKEN_ADMIN2'),
    member: required('TOKEN_MEMBER'),
};

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

function pass(label, detail = '') {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
    return true;
}

function fail(label, detail = '') {
    failures += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    return false;
}

function check(condition, label, detail = '') {
    return condition ? pass(label, detail) : fail(label, detail);
}

async function http(method, path, token, body) {
    const init = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
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
            socket.close();
            reject(new Error(`socket connect failed: ${error.message}`));
        });
    });
}

function request(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${event} ack timeout`)),
            10_000,
        );
        socket.emit(event, payload, (ack) => {
            clearTimeout(timer);
            if (ack === undefined || ack === null || ack.ok !== true) {
                reject(new Error(`${event} failed`));
                return;
            }
            resolve(ack.data ?? null);
        });
    });
}

function waitFor(socket, event, predicate, timeoutMs = 8_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`timeout waiting for ${event}`));
        }, timeoutMs);
        function handler(payload) {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        }
        socket.on(event, handler);
    });
}

async function identity(token) {
    const me = await http('GET', '/auth/getme', token);
    const user = me.data?.user ?? me.data ?? {};
    const phone = user.phone ?? me.data?.phone;
    if (phone === undefined) {
        throw new Error('getme did not return a phone');
    }
    return { userId: Number(user.id), phone: String(phone) };
}

async function membersOf(chatId, token) {
    const page = await http(
        'GET',
        `/chats/${chatId}/members?limit=100`,
        token,
    );
    return Array.isArray(page.data?.items) ? page.data.items : [];
}

function rowFor(rows, userId) {
    return rows.find((row) => Number(row.userId) === userId) ?? null;
}

async function main() {
    const owner = await identity(TOKEN.owner);
    const admin = await identity(TOKEN.admin);
    const admin2 = await identity(TOKEN.admin2);
    const member = await identity(TOKEN.member);

    const created = await http('POST', '/chats/create', TOKEN.owner, {
        title: `Permissions check ${Date.now()}`,
        members: [
            String(admin.userId),
            String(admin2.userId),
            String(member.userId),
        ],
    });
    const chatId = Number(
        created.data?.id ?? created.data?.chat?.id ?? created.data?.chatId,
    );
    check(created.status < 300 && chatId > 0, 'create test group');
    if (!(chatId > 0)) return;

    const ownerSocket = await connect(TOKEN.owner);
    await request(ownerSocket, 'joinChat', { chatId });

    let rows = await membersOf(chatId, TOKEN.owner);
    const adminRowId = Number(rowFor(rows, admin.userId)?.memberId);
    const admin2RowId = Number(rowFor(rows, admin2.userId)?.memberId);
    const memberRowId = Number(rowFor(rows, member.userId)?.memberId);
    const ownerRowId = Number(rowFor(rows, owner.userId)?.memberId);
    check(
        [adminRowId, admin2RowId, memberRowId, ownerRowId].every(
            (id) => Number.isInteger(id) && id > 0,
        ),
        'members list exposes row ids',
    );

    // ── legacy normalization + promotion ──────────────────────────────────
    const promote = await http(
        'POST',
        `/chats/${chatId}/members/${adminRowId}/promote`,
        TOKEN.owner,
        { permissions: ['change_info_chat', 'ban_user', 'delete_message'] },
    );
    check(
        promote.status < 300 && promote.data?.role === 'admin',
        'owner promotes the admin with legacy permission names',
    );

    rows = await membersOf(chatId, TOKEN.owner);
    const promoted = rowFor(rows, admin.userId);
    check(
        Array.isArray(promoted?.permissions) &&
            promoted.permissions.includes('edit_group_info') &&
            promoted.permissions.includes('ban_users') &&
            promoted.permissions.includes('delete_other_messages'),
        'legacy names are normalized in the members DTO',
        JSON.stringify(promoted?.permissions ?? []),
    );
    check(
        Number(promoted?.promotedById) === owner.userId,
        'promotedById records the promoter',
    );

    let info = await http('GET', `/chats/${chatId}/group`, TOKEN.ADMIN);
    check(
        info.data?.capabilities?.canEditInfo === true &&
            info.data?.capabilities?.canManageBans === true,
        'admin capabilities reflect edit_group_info + ban_users',
    );

    // ── edit_group_info ───────────────────────────────────────────────────
    const editInfo = await http('PATCH', `/chats/${chatId}/group`, TOKEN.admin, {
        description: 'edited by admin',
    });
    check(editInfo.status < 300, 'edit_group_info allows the group info edit');

    // ── manage_invites ────────────────────────────────────────────────────
    const inviteDenied = await http(
        'GET',
        `/chats/${chatId}/invite-links`,
        TOKEN.admin,
    );
    check(
        inviteDenied.status === 403,
        'manage_invites denies an admin without it',
    );

    const grantInvites = await http(
        'PUT',
        `/chats/${chatId}/members/${adminRowId}/permissions`,
        TOKEN.owner,
        {
            permissions: [
                'edit_group_info',
                'ban_users',
                'delete_other_messages',
                'manage_invites',
                'remove_members',
                'manage_members',
            ],
        },
    );
    check(grantInvites.status < 300, 'owner replaces an admin permission set');

    const inviteAllowed = await http(
        'GET',
        `/chats/${chatId}/invite-links`,
        TOKEN.admin,
    );
    check(
        inviteAllowed.status < 300,
        'manage_invites allows invite link management',
    );

    // ── manage_messages implication ───────────────────────────────────────
    await http(
        'PUT',
        `/chats/${chatId}/members/${adminRowId}/permissions`,
        TOKEN.owner,
        { permissions: ['manage_messages'] },
    );
    info = await http('GET', `/chats/${chatId}/group`, TOKEN.ADMIN);
    check(
        info.data?.capabilities?.canDeleteOthersMessages === true &&
            info.data?.capabilities?.canPinMessages === true,
        'manage_messages implies delete_other_messages + pin_messages',
    );
    check(
        info.data?.capabilities?.canManageBans === false,
        'manage_messages does not imply ban_users',
    );

    // ── manage_admins + promotedById ──────────────────────────────────────
    await http(
        'PUT',
        `/chats/${chatId}/members/${adminRowId}/permissions`,
        TOKEN.owner,
        { permissions: ['manage_admins', 'ban_users', 'manage_permissions'] },
    );
    const promoteByAdmin = await http(
        'POST',
        `/chats/${chatId}/members/${admin2RowId}/promote`,
        TOKEN.admin,
        { permissions: ['ban_users'] },
    );
    check(
        promoteByAdmin.status < 300,
        'manage_admins lets an admin promote a member',
    );
    rows = await membersOf(chatId, TOKEN.owner);
    const admin2Row = rowFor(rows, admin2.userId);
    check(
        Number(admin2Row?.promotedById) === admin.userId,
        'the promoting admin is recorded on the new admin',
    );

    const demoteOwn = await http(
        'POST',
        `/chats/${chatId}/members/${admin2RowId}/demote`,
        TOKEN.admin,
    );
    check(demoteOwn.status < 300, 'an admin demotes their own promotee');

    const promoteForeign = await http(
        'POST',
        `/chats/${chatId}/members/${admin2RowId}/promote`,
        TOKEN.owner,
        { permissions: ['ban_users'] },
    );
    check(
        promoteForeign.status < 300,
        'owner promotes the second admin (foreign promotee)',
    );
    const demoteForeign = await http(
        'POST',
        `/chats/${chatId}/members/${admin2RowId}/demote`,
        TOKEN.admin,
    );
    check(
        demoteForeign.status === 403,
        'an admin cannot demote another admin’s promotee',
    );

    // ── manage_permissions: grant subset + owner-only all ─────────────────
    const grantSubset = await http(
        'PUT',
        `/chats/${chatId}/members/${admin2RowId}/permissions`,
        TOKEN.admin,
        { permissions: ['ban_users'] },
    );
    check(
        grantSubset.status < 300,
        'manage_permissions saves a grant the editor holds',
    );
    const grantTooMuch = await http(
        'PUT',
        `/chats/${chatId}/members/${admin2RowId}/permissions`,
        TOKEN.admin,
        { permissions: ['edit_group_info'] },
    );
    check(
        grantTooMuch.status === 403,
        'an admin cannot grant a permission they lack',
    );
    const adminAll = await http(
        'PUT',
        `/chats/${chatId}/members/${admin2RowId}/permissions`,
        TOKEN.admin,
        { permissions: ['all'] },
    );
    check(adminAll.status === 403, 'only the owner may grant `all`');

    const ownerAll = await http(
        'PUT',
        `/chats/${chatId}/members/${admin2RowId}/permissions`,
        TOKEN.owner,
        { permissions: ['all'] },
    );
    check(
        ownerAll.status < 300 && ownerAll.data?.hasAll === true,
        'owner grants Full admin (`all`)',
    );

    // ── validation + owner protection ─────────────────────────────────────
    const unknown = await http(
        'PUT',
        `/chats/${chatId}/members/${admin2RowId}/permissions`,
        TOKEN.owner,
        { permissions: ['not_a_permission'] },
    );
    check(unknown.status === 400, 'unknown permission key answers 400');

    const ownerPerms = await http(
        'PUT',
        `/chats/${chatId}/members/${ownerRowId}/permissions`,
        TOKEN.owner,
        { permissions: ['ban_users'] },
    );
    check(ownerPerms.status === 409, 'the owner has no editable permission set');

    const banOwner = await http(
        'POST',
        `/chats/${chatId}/members/${ownerRowId}/ban`,
        TOKEN.admin,
    );
    check(banOwner.status === 403, 'nobody can ban the owner');

    // ── group:changed ─────────────────────────────────────────────────────
    const changed = waitFor(
        ownerSocket,
        'group:changed',
        (event) =>
            Number(event.chatId) === chatId &&
            event.reason === 'permissions_changed' &&
            Number(event.userId) === admin2.userId,
    ).catch(() => null);
    await http(
        'PUT',
        `/chats/${chatId}/members/${admin2RowId}/permissions`,
        TOKEN.owner,
        { permissions: ['ban_users'] },
    );
    check(
        (await changed) !== null,
        'room receives group:changed permissions_changed',
    );

    // ── remove_members + manage_members round trip ────────────────────────
    await http(
        'PUT',
        `/chats/${chatId}/members/${adminRowId}/permissions`,
        TOKEN.owner,
        { permissions: ['remove_members', 'manage_members', 'ban_users'] },
    );
    const removed = await http(
        'DELETE',
        `/chats/${chatId}/members/${memberRowId}`,
        TOKEN.admin,
    );
    check(removed.status < 300, 'remove_members removes a regular member');

    const reAdd = await http(
        'POST',
        `/chats/manage/${chatId}/add/${encodeURIComponent(member.phone)}`,
        TOKEN.admin,
    );
    check(reAdd.status < 300, 'manage_members adds the member back');

    // ── ban_users: ban / list / unban ─────────────────────────────────────
    rows = await membersOf(chatId, TOKEN.owner);
    const memberRow = rowFor(rows, member.userId);
    const ban = await http(
        'POST',
        `/chats/${chatId}/members/${memberRow.memberId}/ban`,
        TOKEN.admin,
    );
    check(ban.status < 300, 'ban_users bans a regular member');

    const banned = await http('GET', `/chats/${chatId}/banned`, TOKEN.admin);
    check(
        Array.isArray(banned.data?.items) &&
            banned.data.items.some(
                (item) => Number(item.userId) === member.userId,
            ),
        'ban_users lists the banned user',
    );

    const unban = await http(
        'POST',
        `/chats/manage/onban/${memberRow.memberId}`,
        TOKEN.admin,
    );
    check(unban.status < 300, 'ban_users unbans the user');

    // ── capabilities per role ─────────────────────────────────────────────
    const ownerCaps = await http('GET', `/chats/${chatId}/group`, TOKEN.owner);
    const memberCaps = await http('GET', `/chats/${chatId}/group`, TOKEN.MEMBER);
    check(
        Object.values(ownerCaps.data?.capabilities ?? {}).every(
            (value) => value === true,
        ),
        'owner capabilities are all true',
    );
    check(
        memberCaps.data?.capabilities?.canEditInfo === false &&
            memberCaps.data?.capabilities?.canManageAdmins === false &&
            memberCaps.data?.capabilities?.canManagePermissions === false,
        'plain member capabilities are all false',
    );
}

main()
    .catch((error) => {
        failures += 1;
        console.error(`FAIL script crashed — ${error?.message ?? error}`);
    })
    .finally(() => {
        for (const socket of sockets) socket.close();
        console.log(
            failures === 0
                ? '\nALL CHECKS PASSED'
                : `\n${failures} CHECK(S) FAILED`,
        );
        process.exitCode = failures === 0 ? 0 : 1;
    });
