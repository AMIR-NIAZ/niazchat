#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live checks for `POST /auth/refresh-token`.
 *
 * Required env:
 *   URL            API origin (no trailing slash)
 *   REFRESH_TOKEN  a valid refresh token (alias: TOKEN_REFRESH)
 *
 * Optional:
 *   ACCESS_TOKEN   an access token used to prove the endpoint still works
 *
 * What it prints:
 *   PASS/FAIL per assertion, NOTE for behavior the backend documents but does
 *   not implement (rotation), exit code 1 on any FAIL, 2 on bad configuration.
 *
 * Contract under test (docs/mobile-api/authentication.md):
 *   - valid token → 200 { accessToken }
 *   - garbage/blank token → 401 { success:false, statusCode:401,
 *     message:'invalid refresh token' } (never 500)
 *   - refresh token is NOT rotated: using the same token twice is allowed and
 *     the first token is NOT invalidated (so there is no grace-window issue)
 */

const BASE = (process.env.URL ?? '').replace(/\/+$/, '');
const REFRESH_TOKEN = process.env.REFRESH_TOKEN ?? process.env.TOKEN_REFRESH ?? '';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN ?? '';

const INVALID_MESSAGE = 'invalid refresh token';

let passed = 0;
let failed = 0;

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
        log('FAIL', name, error instanceof Error ? error.message : String(error));
    }
}

function note(name, detail) {
    log('NOTE', name, detail);
}

async function refresh(token) {
    const response = await fetch(`${BASE}/auth/refresh-token`, {
        method: 'POST',
        headers:
            token === undefined ? {} : { token },
    });
    let body = null;
    const text = await response.text();
    try {
        body = text === '' ? null : JSON.parse(text);
    } catch {
        body = { raw: text };
    }
    return { status: response.status, body };
}

async function main() {
    if (BASE === '') {
        console.error('Missing env: URL');
        process.exit(2);
    }
    if (REFRESH_TOKEN === '') {
        console.error(
            'Missing env: REFRESH_TOKEN (sign in via the app or verify-otp and use the returned refreshToken)',
        );
        process.exit(2);
    }

    let accessToken = null;

    await test('valid refresh token returns a new access token', async () => {
        const result = await refresh(REFRESH_TOKEN);
        check(result.status === 200, `status ${result.status}: ${JSON.stringify(result.body)}`);
        check(
            typeof result.body?.accessToken === 'string' &&
                result.body.accessToken !== '',
            'response has no accessToken',
        );
        accessToken = result.body.accessToken;
    });

    await test('the refreshed access token authenticates', async () => {
        check(accessToken !== null, 'no access token from the previous step');
        const response = await fetch(`${BASE}/auth/getme`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        check(
            response.status === 200,
            `GET /auth/getme returned ${response.status}`,
        );
    });

    await test('garbage refresh token is rejected with 401 (not 500)', async () => {
        const result = await refresh('not-a-jwt');
        check(result.status === 401, `status ${result.status}`);
        check(
            result.body?.statusCode === 401,
            `statusCode ${JSON.stringify(result.body?.statusCode)}`,
        );
        check(
            result.body?.message === INVALID_MESSAGE,
            `message ${JSON.stringify(result.body?.message)}`,
        );
    });

    await test('missing token header is rejected with 401', async () => {
        const result = await refresh(undefined);
        check(result.status === 401, `status ${result.status}`);
        check(
            result.body?.message === INVALID_MESSAGE,
            `message ${JSON.stringify(result.body?.message)}`,
        );
    });

    await test('two concurrent uses of the same token are safe', async () => {
        const [first, second] = await Promise.all([
            refresh(REFRESH_TOKEN),
            refresh(REFRESH_TOKEN),
        ]);
        const successes = [first, second].filter((item) => item.status === 200);
        const rotates = [first, second].some(
            (item) =>
                typeof item.body?.refreshToken === 'string' &&
                item.body.refreshToken !== REFRESH_TOKEN,
        );

        if (rotates) {
            // Rotation contract: at most one of the two may win.
            check(successes.length <= 1, `both concurrent refreshes succeeded`);
            const old = await refresh(REFRESH_TOKEN);
            check(old.status === 401, `old token still ${old.status}`);
        } else {
            // No rotation: both calls are valid and the token stays usable.
            check(
                successes.length === 2,
                `expected both to succeed, got ${successes.length}/2`,
            );
            note(
                'no refresh-token rotation',
                'backend returns only accessToken; the same refresh token stays valid twice (documented)',
            );
        }
    });

    await test('the old access token is not required to stay valid', async () => {
        if (ACCESS_TOKEN === '') {
            note('ACCESS_TOKEN not provided', 'skipped the old-token check');
            return;
        }
        const response = await fetch(`${BASE}/auth/getme`, {
            headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        });
        // Informational: access tokens are stateless and stay valid until exp.
        note('previous access token status', String(response.status));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
