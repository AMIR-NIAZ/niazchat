#!/usr/bin/env node
/**
 * Saved-contact endpoint check against a running backend.
 *
 *   URL=http://localhost:3000 TOKEN_A=<token> TOKEN_B=<token> \
 *     node scripts/contacts.js
 *
 * A and B are two DIFFERENT accounts. The script cleans up only the contacts A
 * saved for B, and never prints phone numbers or tokens.
 *
 * Exit code is non-zero when any assertion fails.
 */

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A ?? '';
const TOKEN_B = process.env.TOKEN_B ?? '';

if (BASE === '' || TOKEN_A === '' || TOKEN_B === '') {
    console.error('URL, TOKEN_A and TOKEN_B env vars are required.');
    process.exit(2);
}

const UNKNOWN_USER_ID = 2147483647;
const UNKNOWN_PHONE = '+19999999999';
const UNKNOWN_USERNAME = `nobody_${Date.now().toString(36)}`;

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

async function http(path, token, init = {}) {
    const headers = { ...(init.headers ?? {}) };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(`${BASE}${path}`, { ...init, headers });
}

async function json(response) {
    return response.json().catch(() => null);
}

function postContact(token, body) {
    return http('/contacts', token, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

async function listContacts(token) {
    const response = await http('/contacts', token);
    const body = await json(response);
    return { status: response.status, body };
}

async function cleanupFor(token, userId) {
    const { body } = await listContacts(token);
    const items = Array.isArray(body?.items) ? body.items : [];
    for (const item of items) {
        if (Number(item.userId) === Number(userId)) {
            await http(`/contacts/${item.id}`, token, { method: 'DELETE' });
        }
    }
}

async function main() {
    const meA = await json(await http('/auth/getme', TOKEN_A));
    const meB = await json(await http('/auth/getme', TOKEN_B));
    if (!assert('A getme works', typeof meA?.id === 'number', String(meA?.id))) {
        process.exit(1);
    }
    if (!assert('B getme works', typeof meB?.id === 'number', String(meB?.id))) {
        process.exit(1);
    }
    if (
        !assert(
            'B has a username and phone',
            typeof meB.username === 'string' &&
                meB.username.length > 0 &&
                typeof meB.phone === 'string' &&
                meB.phone.startsWith('+'),
            'both set',
        )
    ) {
        process.exit(1);
    }
    assert('A and B are different accounts', meA.id !== meB.id, `${meA.id} / ${meB.id}`);

    await cleanupFor(TOKEN_A, meB.id);

    // ── 401 without a token ────────────────────────────────────────────────
    const anonymous = await http('/contacts', null);
    assert('GET /contacts unauthenticated returns 401', anonymous.status === 401, String(anonymous.status));

    // ── 400 for zero or multiple selectors ─────────────────────────────────
    const none = await postContact(TOKEN_A, { alias: 'nobody' });
    assert('no selector returns 400', none.status === 400, String(none.status));
    const both = await postContact(TOKEN_A, {
        userId: meB.id,
        username: meB.username,
    });
    assert('two selectors returns 400', both.status === 400, String(both.status));

    // ── add by userId ──────────────────────────────────────────────────────
    const byId = await postContact(TOKEN_A, { userId: meB.id, alias: '  By id  ' });
    const byIdBody = await json(byId);
    assert('add by userId returns 201', byId.status === 201, String(byId.status));
    const createdId = byIdBody?.id;
    assert('add by userId returns an id', typeof createdId === 'number', String(createdId));
    assert('add by userId returns B userId', Number(byIdBody?.userId) === Number(meB.id), String(byIdBody?.userId));
    assert('alias is trimmed', byIdBody?.alias === 'By id', String(byIdBody?.alias));
    assert(
        'add by userId does NOT expose a phone',
        byIdBody?.phone === undefined,
        'phone omitted',
    );
    assert(
        'add by userId carries name/username/avatars',
        typeof byIdBody?.name === 'string' &&
            (byIdBody?.username === null || typeof byIdBody?.username === 'string') &&
            Array.isArray(byIdBody?.avatars),
        'projection complete',
    );

    // ── duplicate 409 (and the existing item comes back) ───────────────────
    const duplicate = await postContact(TOKEN_A, { userId: meB.id });
    const duplicateBody = await json(duplicate);
    assert('duplicate add returns 409', duplicate.status === 409, String(duplicate.status));
    assert(
        'duplicate add returns the existing item',
        Number(duplicateBody?.item?.id) === Number(createdId),
        String(duplicateBody?.item?.id),
    );

    // ── GET list ───────────────────────────────────────────────────────────
    const listed = await listContacts(TOKEN_A);
    assert('GET /contacts returns 200', listed.status === 200, String(listed.status));
    const listedItems = Array.isArray(listed.body?.items) ? listed.body.items : [];
    const listedB = listedItems.find((item) => Number(item.id) === Number(createdId));
    assert('GET /contacts contains the saved contact', listedB !== undefined, `${listedItems.length} item(s)`);

    // ── rename ─────────────────────────────────────────────────────────────
    const renamed = await http(`/contacts/${createdId}`, TOKEN_A, {
        method: 'PATCH',
        body: JSON.stringify({ alias: 'Renamed B' }),
    });
    const renamedBody = await json(renamed);
    assert('PATCH renames the contact', renamed.status === 200, String(renamed.status));
    assert('PATCH returns the new alias', renamedBody?.alias === 'Renamed B', String(renamedBody?.alias));

    const cleared = await http(`/contacts/${createdId}`, TOKEN_A, {
        method: 'PATCH',
        body: JSON.stringify({ alias: null }),
    });
    const clearedBody = await json(cleared);
    assert('PATCH clears the alias with null', cleared.status === 200 && clearedBody?.alias === null, String(clearedBody?.alias));

    // ── access control: B cannot edit or delete A's contact ────────────────
    const foreignPatch = await http(`/contacts/${createdId}`, TOKEN_B, {
        method: 'PATCH',
        body: JSON.stringify({ alias: 'stolen' }),
    });
    assert("B cannot rename A's contact (404)", foreignPatch.status === 404, String(foreignPatch.status));
    const foreignDelete = await http(`/contacts/${createdId}`, TOKEN_B, {
        method: 'DELETE',
    });
    assert("B cannot delete A's contact (404)", foreignDelete.status === 404, String(foreignDelete.status));

    // ── delete ─────────────────────────────────────────────────────────────
    const deleted = await http(`/contacts/${createdId}`, TOKEN_A, {
        method: 'DELETE',
    });
    assert('DELETE returns 200', deleted.status === 200, String(deleted.status));
    const afterDelete = await http(`/contacts/${createdId}`, TOKEN_A, {
        method: 'DELETE',
    });
    assert('deleting again returns 404', afterDelete.status === 404, String(afterDelete.status));

    // ── add by username ────────────────────────────────────────────────────
    const byUsername = await postContact(TOKEN_A, {
        username: `@${meB.username.toUpperCase()}`,
    });
    const byUsernameBody = await json(byUsername);
    assert('add by username (case/@) returns 201', byUsername.status === 201, String(byUsername.status));
    assert(
        'add by username does NOT expose a phone',
        byUsernameBody?.phone === undefined,
        'phone omitted',
    );
    if (typeof byUsernameBody?.id === 'number') {
        await http(`/contacts/${byUsernameBody.id}`, TOKEN_A, { method: 'DELETE' });
    }

    // ── add by phone ───────────────────────────────────────────────────────
    const byPhone = await postContact(TOKEN_A, {
        phone: meB.phone,
        alias: 'By phone',
    });
    const byPhoneBody = await json(byPhone);
    assert('add by phone returns 201', byPhone.status === 201, String(byPhone.status));
    assert(
        'add by phone echoes the supplied phone',
        byPhoneBody?.phone === meB.phone,
        'canonical E.164',
    );

    // Local-format number: normalized with the IR default region.
    await http(`/contacts/${byPhoneBody?.id}`, TOKEN_A, { method: 'DELETE' });
    const localFormat = meB.phone.startsWith('+98')
        ? `0${meB.phone.slice(3)}`
        : meB.phone;
    const byLocalPhone = await postContact(TOKEN_A, { phone: localFormat });
    assert(
        'add by local-format phone normalizes to E.164',
        byLocalPhone.status === 201,
        String(byLocalPhone.status),
    );
    const byLocalBody = await json(byLocalPhone);
    if (typeof byLocalBody?.id === 'number') {
        await http(`/contacts/${byLocalBody.id}`, TOKEN_A, { method: 'DELETE' });
    }

    // ── self 400 ───────────────────────────────────────────────────────────
    const self = await postContact(TOKEN_A, { userId: meA.id });
    assert('adding yourself returns 400', self.status === 400, String(self.status));

    // ── unknown 404 ────────────────────────────────────────────────────────
    const unknownUser = await postContact(TOKEN_A, { userId: UNKNOWN_USER_ID });
    assert('unknown userId returns 404', unknownUser.status === 404, String(unknownUser.status));
    const unknownUsername = await postContact(TOKEN_A, {
        username: UNKNOWN_USERNAME,
    });
    assert('unknown username returns 404', unknownUsername.status === 404, String(unknownUsername.status));
    const unknownPhone = await postContact(TOKEN_A, { phone: UNKNOWN_PHONE });
    assert('unknown phone returns 404', unknownPhone.status === 404, String(unknownPhone.status));
    const unknownBody = await json(unknownPhone);
    assert(
        'unknown phone message is friendly',
        typeof unknownBody?.message === 'string' &&
            unknownBody.message.includes("isn't on the app yet"),
        unknownBody?.message,
    );

    // ── invalid id / phone payloads ────────────────────────────────────────
    const badPhone = await postContact(TOKEN_A, { phone: 'not-a-number' });
    assert('invalid phone returns 400', badPhone.status === 400, String(badPhone.status));
    const badId = await http('/contacts/not-a-number', TOKEN_A, {
        method: 'DELETE',
    });
    assert('non-numeric contact id returns 400', badId.status === 400, String(badId.status));

    finish();
}

function finish() {
    if (failures > 0) {
        console.error(`\n${failures} contacts check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll contacts checks passed.');
}

main().catch((error) => {
    console.error('check crashed:', error);
    process.exit(1);
});
