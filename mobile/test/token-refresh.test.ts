/**
 * Plain-TS unit tests for the session refresh rules.
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node","types":["node"]}' mobile/test/token-refresh.test.ts
 */
import {
    classifyRefreshStatus,
    createIdempotentAction,
    createSingleFlight,
    decideColdStart,
    persistTokenPair,
    TOKEN_EXPIRY_MARGIN_SECONDS,
    type RefreshSessionResult,
} from '../src/features/auth/session-refresh-model';
import {
    decodeJwtPayload,
    getTokenExpiry,
    isTokenExpired,
} from '../src/features/auth/token-expiry';

let failures = 0;

async function test(
    name: string,
    fn: () => void | Promise<void>,
): Promise<void> {
    try {
        await fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}`);
        console.error(error instanceof Error ? error.stack : error);
    }
}

function assertEqual<T>(actual: T, expected: T, label = ''): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

function assertTrue(value: boolean, label: string): void {
    if (!value) throw new Error(label);
}

function base64Url(value: string): string {
    const nodeBuffer = (
        globalThis as {
            Buffer?: {
                from: (input: string) => {
                    toString: (encoding: string) => string;
                };
            };
        }
    ).Buffer;
    if (nodeBuffer === undefined) throw new Error('Buffer is unavailable');
    return nodeBuffer
        .from(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function makeToken(payload: Record<string, unknown>): string {
    return `${base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64Url(
        JSON.stringify(payload),
    )}.signature`;
}

const NOW = 1_700_000_000_000; // ms

async function main(): Promise<void> {
    await test('getTokenExpiry decodes exp in milliseconds (base64url)', () => {
        const token = makeToken({ sub: 7, exp: 1_700_000_000 });
        assertEqual(getTokenExpiry(token), 1_700_000_000_000);
        // URL-safe alphabet + omitted padding survive the decode.
        const payload = decodeJwtPayload(token);
        assertEqual(payload?.sub, 7);
        assertEqual(payload?.exp, 1_700_000_000);
    });

    await test('getTokenExpiry tolerates padding and malformed tokens', () => {
        const padded = `${base64Url(JSON.stringify({ exp: 123 }))}==`;
        assertEqual(getTokenExpiry(`h.${padded}.s`), 123_000, 'padded payload');
        assertEqual(getTokenExpiry(null), null);
        assertEqual(getTokenExpiry(undefined), null);
        assertEqual(getTokenExpiry(''), null);
        assertEqual(getTokenExpiry('not-a-jwt'), null);
        assertEqual(getTokenExpiry('a.b.c'), null);
        assertEqual(getTokenExpiry('a.!!!.c'), null);
        assertEqual(getTokenExpiry(makeToken({ sub: 1 })), null, 'missing exp');
        assertEqual(
            getTokenExpiry(makeToken({ exp: '1700000000' })),
            null,
            'string exp',
        );
        assertEqual(getTokenExpiry(makeToken({ exp: 0 })), null, 'zero exp');
    });

    await test('expiry uses the 60-second margin and treats unreadable as expired', () => {
        assertEqual(TOKEN_EXPIRY_MARGIN_SECONDS, 60);
        const in61 = makeToken({ exp: (NOW + 61_000) / 1000 });
        const in59 = makeToken({ exp: (NOW + 59_000) / 1000 });
        assertEqual(
            isTokenExpired(in61, { nowMs: NOW }),
            false,
            '61s left is valid',
        );
        assertEqual(
            isTokenExpired(in59, { nowMs: NOW }),
            true,
            '59s left is expired',
        );
        assertEqual(
            isTokenExpired(in59, { nowMs: NOW, marginSeconds: 0 }),
            false,
            'no margin inside the token lifetime',
        );
        assertEqual(
            isTokenExpired('garbage', { nowMs: NOW }),
            true,
            'malformed',
        );
        assertEqual(isTokenExpired(null, { nowMs: NOW }), true, 'missing');
    });

    await test('ten concurrent callers share one refresh round-trip', async () => {
        let calls = 0;
        const flight = createSingleFlight(
            async (): Promise<RefreshSessionResult> => {
                calls += 1;
                await new Promise((resolve) => setTimeout(resolve, 5));
                return { status: 'ok', accessToken: 'fresh-token' };
            },
        );

        const results = await Promise.all(
            Array.from({ length: 10 }, () => flight.start()),
        );
        assertEqual(calls, 1, 'network calls');
        for (const result of results) {
            assertEqual(result, { status: 'ok', accessToken: 'fresh-token' });
        }
        assertTrue(
            results.every((result) => result === results[0]),
            'same result',
        );

        await flight.wait();
        await flight.start();
        assertEqual(calls, 2, 'a later caller starts a new round-trip');
    });

    await test('refresh failure classification is 401/403 → rejected only', () => {
        assertEqual(classifyRefreshStatus(401), 'rejected');
        assertEqual(classifyRefreshStatus(403), 'rejected');
        assertEqual(classifyRefreshStatus(400), 'unavailable');
        assertEqual(classifyRefreshStatus(429), 'unavailable');
        assertEqual(classifyRefreshStatus(500), 'unavailable');
        assertEqual(classifyRefreshStatus(null), 'unavailable');
        assertEqual(classifyRefreshStatus(undefined), 'unavailable');
    });

    await test('refresh token is written BEFORE the access token', async () => {
        const order: string[] = [];
        await persistTokenPair(
            { accessToken: 'access', refreshToken: 'refresh' },
            {
                writeRefreshToken: (token): Promise<void> => {
                    order.push(`refresh:${token}`);
                    return Promise.resolve();
                },
                writeAccessToken: (token): Promise<void> => {
                    order.push(`access:${token}`);
                    return Promise.resolve();
                },
            },
        );
        assertEqual(order, ['refresh:refresh', 'access:access']);
    });

    await test('logout is idempotent: concurrent failures run once', async () => {
        let runs = 0;
        let done = false;
        const action = createIdempotentAction(
            async (): Promise<void> => {
                runs += 1;
                await new Promise((resolve) => setTimeout(resolve, 5));
                done = true;
            },
            () => done,
        );

        await Promise.all([action(), action(), action()]);
        assertEqual(runs, 1, 'concurrent calls');

        await action();
        assertEqual(runs, 1, 'already logged out');

        done = false; // a new login allows the next logout to run
        await action();
        assertEqual(runs, 2, 'new session');
    });

    await test('cold start decision table', () => {
        const tokens = {
            accessToken: 'stored',
            hasRefreshToken: true,
        };

        assertEqual(
            decideColdStart({
                accessToken: null,
                hasRefreshToken: false,
                refreshResult: null,
                storedAccessTokenUsable: false,
            }),
            { kind: 'guest' },
            'no tokens at all',
        );

        assertEqual(
            decideColdStart({
                ...tokens,
                refreshResult: { status: 'ok', accessToken: 'fresh' },
                storedAccessTokenUsable: false,
            }),
            {
                kind: 'authenticated',
                accessToken: 'fresh',
                source: 'refreshed',
            },
            'refresh ok',
        );

        assertEqual(
            decideColdStart({
                ...tokens,
                refreshResult: { status: 'rejected' },
                storedAccessTokenUsable: true,
            }),
            { kind: 'guest' },
            'refresh rejected',
        );

        assertEqual(
            decideColdStart({
                ...tokens,
                refreshResult: { status: 'unavailable' },
                storedAccessTokenUsable: true,
            }),
            { kind: 'authenticated', accessToken: 'stored', source: 'stored' },
            'unavailable with a valid access token',
        );

        assertEqual(
            decideColdStart({
                ...tokens,
                refreshResult: { status: 'unavailable' },
                storedAccessTokenUsable: false,
            }),
            { kind: 'unreachable' },
            'unavailable with an expired access token',
        );

        assertEqual(
            decideColdStart({
                accessToken: 'expired',
                hasRefreshToken: false,
                refreshResult: null,
                storedAccessTokenUsable: false,
            }),
            { kind: 'guest' },
            'expired access token without a refresh token',
        );

        assertEqual(
            decideColdStart({
                accessToken: 'expired',
                hasRefreshToken: true,
                refreshResult: null,
                storedAccessTokenUsable: false,
            }),
            { kind: 'unreachable' },
            'refresh token exists but no refresh was attempted (offline)',
        );
    });

    if (failures > 0) {
        console.error(`${failures} test(s) failed`);
        const nodeProcess = (globalThis as { process?: { exitCode?: number } })
            .process;
        if (nodeProcess !== undefined) nodeProcess.exitCode = 1;
    } else {
        console.log('All token-refresh tests passed');
    }
}

void main();
