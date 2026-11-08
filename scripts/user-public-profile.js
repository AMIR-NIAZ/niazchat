#!/usr/bin/env node
/**
 * Public user-profile endpoint check against a running backend.
 *
 *   URL=http://localhost:3000 TOKEN_A=<token> TOKEN_B=<token> \
 *     node scripts/user-public-profile.js
 *
 * A and B are two DIFFERENT accounts that do not have to share a chat: the
 * point is that A can read B's public profile. Exit code is non-zero when any
 * assertion fails.
 */

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const TOKEN_A = process.env.TOKEN_A ?? '';
const TOKEN_B = process.env.TOKEN_B ?? '';

if (BASE === '' || TOKEN_A === '' || TOKEN_B === '') {
    console.error('URL, TOKEN_A and TOKEN_B env vars are required.');
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

const PUBLIC_KEYS = [
    'avatars',
    'biografy',
    'id',
    'isOnline',
    'lastSeen',
    'name',
    'username',
];

async function http(path, token, init = {}) {
    const headers = { ...(init.headers ?? {}) };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, { ...init, headers });
}

async function json(response) {
    return response.json().catch(() => null);
}

async function main() {
    // Who are A and B? (`GET /auth/getme` is the bare user projection.)
    const meA = await json(await http('/auth/getme', TOKEN_A));
    const meB = await json(await http('/auth/getme', TOKEN_B));
    if (!assert('A getme works', typeof meA?.id === 'number', String(meA?.id))) {
        process.exit(1);
    }
    if (!assert('B getme works', typeof meB?.id === 'number', String(meB?.id))) {
        process.exit(1);
    }
    assert('A and B are different accounts', meA.id !== meB.id, `${meA.id} / ${meB.id}`);

    // ── A views B: no shared chat required ─────────────────────────────────
    const view = await http(`/user/${meB.id}/profile`, TOKEN_A);
    const body = await json(view);
    assert('A can view B with 200', view.status === 200, String(view.status));

    if (body === null || typeof body !== 'object') {
        fail('profile body is a JSON object', String(body));
        return finish();
    }

    const keys = Object.keys(body).sort();
    assert(
        'response has exactly the public fields',
        JSON.stringify(keys) === JSON.stringify(PUBLIC_KEYS),
        keys.join(','),
    );
    assert('id is B and numeric', body.id === meB.id, String(body.id));
    assert(
        'no phone / token / role / status fields',
        !('phone' in body) &&
            !('refreshToken' in body) &&
            !('role' in body) &&
            !('status' in body) &&
            !JSON.stringify(body).includes(meB.phone ?? '\u0000'),
        'body is clean',
    );
    assert(
        'all avatars are present and current first',
        Array.isArray(body.avatars) &&
            JSON.stringify(body.avatars) === JSON.stringify(meB.avatars ?? []),
        `${Array.isArray(body.avatars) ? body.avatars.length : 'not an array'} photo(s)`,
    );

    const cacheControl = view.headers.get('cache-control') ?? '';
    assert(
        'cache-control is private + 30s',
        cacheControl.includes('private') && cacheControl.includes('max-age=30'),
        cacheControl || 'none',
    );
    const etag = view.headers.get('etag');
    assert('response has an ETag', typeof etag === 'string' && etag.length > 0, String(etag));
    if (etag !== null) {
        const conditional = await http(`/user/${meB.id}/profile`, TOKEN_A, {
            headers: { 'If-None-Match': etag },
        });
        assert('If-None-Match returns 304', conditional.status === 304, String(conditional.status));
    }

    // ── viewing myself uses the same shape ─────────────────────────────────
    const self = await http(`/user/${meA.id}/profile`, TOKEN_A);
    const selfBody = await json(self);
    assert('viewing myself returns 200', self.status === 200, String(self.status));
    assert(
        'viewing myself uses the same public shape',
        selfBody !== null &&
            JSON.stringify(Object.keys(selfBody).sort()) === JSON.stringify(PUBLIC_KEYS),
        String(self.status),
    );

    // ── 404: unknown and non-active are indistinguishable ──────────────────
    const missing = await http('/user/999999999/profile', TOKEN_A);
    const missingBody = await json(missing);
    assert('non-existent id returns 404', missing.status === 404, String(missing.status));
    assert(
        '404 message is explicit',
        typeof missingBody?.message === 'string' &&
            missingBody.message.toLowerCase().includes('user not found'),
        JSON.stringify(missingBody?.message),
    );

    // ── 400: invalid ids ───────────────────────────────────────────────────
    for (const id of ['abc', '0', '-1']) {
        const invalid = await http(`/user/${id}/profile`, TOKEN_A);
        assert(`invalid id "${id}" returns 400`, invalid.status === 400, String(invalid.status));
    }

    // ── 401: no token ──────────────────────────────────────────────────────
    const anonymous = await http(`/user/${meB.id}/profile`, null);
    assert('unauthenticated returns 401', anonymous.status === 401, String(anonymous.status));

    // ── legacy static route still works ────────────────────────────────────
    if (typeof meA.username === 'string' && meA.username !== '') {
        const legacy = await http(`/user/pv/${encodeURIComponent(meA.username)}`, TOKEN_B);
        const legacyBody = await json(legacy);
        assert('GET /user/pv/:userName still returns 200', legacy.status === 200, String(legacy.status));
        assert(
            'GET /user/pv/:userName keeps its wrapped full shape',
            legacyBody?.data?.id === meA.id && 'phone' in (legacyBody.data ?? {}),
            String(legacyBody?.data?.id),
        );
    } else {
        console.log('SKIP  GET /user/pv/:userName check (A has no username set)');
    }

    // Throttling is not installed at all, so there is no 429 to verify.
    console.log('SKIP  429 check (@nestjs/throttler is not installed)');

    finish();
}

function finish() {
    if (failures > 0) {
        console.error(`\n${failures} public-profile check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll public-profile checks passed.');
}

main().catch((error) => {
    console.error('check crashed:', error);
    process.exit(1);
});
