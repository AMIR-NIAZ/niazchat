#!/usr/bin/env node
/**
 * Phone-contact matching endpoint check against a running backend.
 *
 *   URL=http://localhost:3000 TOKEN_A=<token> TOKEN_B=<token> \
 *     node scripts/contacts-match.js
 *
 * A and B are two DIFFERENT accounts. A must know B's phone number (read from
 * `GET /auth/getme` here, which is what a real address book would contain).
 * The script never prints phone numbers.
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

const MAX_PHONES = 500;
const UNKNOWN_PHONE = '+19999999999';

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

function match(token, phones) {
    return http('/contacts/match', token, {
        method: 'POST',
        body: JSON.stringify({ phones }),
    });
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
            'A and B have phone numbers',
            typeof meA.phone === 'string' && typeof meB.phone === 'string',
            'both set',
        )
    ) {
        process.exit(1);
    }
    assert('A and B are different accounts', meA.id !== meB.id, `${meA.id} / ${meB.id}`);

    // ── matches a known number ─────────────────────────────────────────────
    const matched = await match(TOKEN_A, [meB.phone]);
    const matchedBody = await json(matched);
    assert('known number returns 200', matched.status === 200, String(matched.status));
    const items = Array.isArray(matchedBody?.items) ? matchedBody.items : [];
    const hit = items.find((item) => item.userId === meB.id);
    assert('known number matches B', hit !== undefined, `${items.length} item(s)`);
    if (hit !== undefined) {
        assert('match carries B phone (uploaded number)', hit.phone === meB.phone, 'canonical E.164');
        assert('match carries a name', typeof hit.name === 'string' && hit.name.length > 0, hit.name);
        assert('match carries username or null', hit.username === null || typeof hit.username === 'string', String(hit.username));
        assert('match carries avatars array', Array.isArray(hit.avatars), `${hit.avatars?.length ?? 'n/a'} photo(s)`);
        assert(
            'match item has no internal fields',
            !('status' in hit) && !('role' in hit) && !('refreshToken' in hit),
            'whitelist only',
        );
    }

    // ── ignores unknown numbers ────────────────────────────────────────────
    const unknown = await match(TOKEN_A, [UNKNOWN_PHONE]);
    const unknownBody = await json(unknown);
    assert('unknown number returns 200', unknown.status === 200, String(unknown.status));
    assert(
        'unknown number returns no items',
        Array.isArray(unknownBody?.items) && unknownBody.items.length === 0,
        `${unknownBody?.items?.length ?? 'n/a'} item(s)`,
    );

    // ── excludes the caller ────────────────────────────────────────────────
    const self = await match(TOKEN_A, [meA.phone]);
    const selfBody = await json(self);
    assert('own number returns 200', self.status === 200, String(self.status));
    assert(
        'own number is excluded',
        Array.isArray(selfBody?.items) &&
            selfBody.items.every((item) => item.userId !== meA.id),
        `${selfBody?.items?.length ?? 'n/a'} item(s)`,
    );

    // ── duplicates collapse and invalid entries are dropped ────────────────
    const noisy = await match(TOKEN_A, [meB.phone, meB.phone, 'not-a-number', '09120000000']);
    const noisyBody = await json(noisy);
    assert('duplicates/invalid entries return 200', noisy.status === 200, String(noisy.status));
    const noisyHits = (noisyBody?.items ?? []).filter((item) => item.userId === meB.id);
    assert('duplicates collapse to one match', noisyHits.length === 1, `${noisyHits.length} hit(s)`);

    // ── 400 above 500 numbers ──────────────────────────────────────────────
    const tooMany = await match(TOKEN_A, Array.from({ length: MAX_PHONES + 1 }, () => meB.phone));
    assert('more than 500 numbers returns 400', tooMany.status === 400, String(tooMany.status));
    const atLimit = await match(TOKEN_A, Array.from({ length: MAX_PHONES }, () => meB.phone));
    assert(`exactly ${MAX_PHONES} numbers returns 200`, atLimit.status === 200, String(atLimit.status));

    // ── 400 for a malformed body ───────────────────────────────────────────
    const notArray = await http('/contacts/match', TOKEN_A, {
        method: 'POST',
        body: JSON.stringify({ phones: 'oops' }),
    });
    assert('non-array phones returns 400', notArray.status === 400, String(notArray.status));

    // ── 401 without a token ────────────────────────────────────────────────
    const anonymous = await match(null, [meB.phone]);
    assert('unauthenticated returns 401', anonymous.status === 401, String(anonymous.status));

    // ── 429 after 10 requests in the window ────────────────────────────────
    let limitedAt = 0;
    for (let attempt = 1; attempt <= 15; attempt += 1) {
        const response = await match(TOKEN_B, [meB.phone]);
        if (response.status === 429) {
            limitedAt = attempt;
            break;
        }
    }
    assert('rate limit answers 429 within 15 requests', limitedAt > 0, limitedAt > 0 ? `on request ${limitedAt}` : 'never');

    finish();
}

function finish() {
    if (failures > 0) {
        console.error(`\n${failures} contacts-match check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll contacts-match checks passed.');
}

main().catch((error) => {
    console.error('check crashed:', error);
    process.exit(1);
});
