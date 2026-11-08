#!/usr/bin/env node
/**
 * Identity checks for the mobile app's "is this message mine?" logic.
 *
 * Usage (from the repo root):
 *   node_modules/.bin/ts-node --transpile-only \
 *     -O '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/user-identity-check.ts
 *
 * Covers the `['me']` cache merge (message-only response, string id, `{ data }`
 * envelope, full user) and `isOwnMessage` with null/string/number ids, plus the
 * access-token `sub` decoder. Exit code: 0 when every check passes, 1 otherwise.
 */

import { normalizeUserPayload, mergeMeCache } from '../mobile/src/features/users/me-cache';
import { isOwnMessage } from '../mobile/src/features/messages/messages-model';
import { accessTokenSubject } from '../mobile/src/features/auth/access-token-subject';
import type { UserDto } from '../mobile/src/core/api/dto/user.dto';

let failures = 0;

/** Stable text for deep comparison (object key order never matters). */
function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map(
                (key) =>
                    `${JSON.stringify(key)}:${canonical(record[key])}`,
            )
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

function check(name: string, actual: unknown, expected: unknown): void {
    const actualText = canonical(actual);
    const expectedText = canonical(expected);
    if (actualText === expectedText) {
        console.log(`PASS  ${name}`);
        return;
    }
    failures += 1;
    console.log(`FAIL  ${name} — got ${actualText}, expected ${expectedText}`);
}

const base = {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    phone: '09120000000',
    name: 'Ada',
    biografy: null,
    username: 'ada_dev',
    avatars: [] as string[],
    isOnline: false,
    lastSeen: null,
    status: 'active' as const,
};

/** Cached user as `useMe`/`fetchMe` stores it: numeric id. */
const previous: UserDto = { id: 2, ...base };

function tokenWithPayload(payload: unknown): string {
    const encode = (value: string): string =>
        Buffer.from(value, 'utf8')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    return `${encode('{"alg":"HS256","typ":"JWT"}')}.${encode(
        JSON.stringify(payload),
    )}.signature`;
}

// ---------------------------------------------------------------- me-cache
check(
    'update response without id keeps the cached user untouched',
    mergeMeCache(previous, { message: 'user updated is 1' }),
    previous,
);

check(
    'normalizer rejects an id-less body',
    normalizeUserPayload({ message: 'user updated is 1' }),
    null,
);

check(
    'string id is normalized to a number and merged',
    mergeMeCache(previous, { ...base, id: '2', name: 'Grace' }),
    { ...previous, name: 'Grace', id: 2 },
);

check(
    'wrapped { data } response is unwrapped',
    mergeMeCache(previous, { data: { ...base, id: '2', name: 'Grace' } }),
    { ...previous, name: 'Grace', id: 2 },
);

check(
    'full bare user response merges and keeps the cache id',
    mergeMeCache(previous, { ...base, id: 2, name: 'Grace', biografy: 'hi' }),
    { ...previous, name: 'Grace', biografy: 'hi', id: 2 },
);

check(
    'a different id in the response never replaces the cached id',
    mergeMeCache(previous, { ...base, id: '9' }),
    { ...previous, id: 2 },
);

check(
    'cold cache accepts a complete { user } response with numeric id',
    mergeMeCache(null, { message: 'ok', user: { ...base, id: '7' } }),
    { id: 7, ...base },
);

check(
    'cold cache refuses a response without a user',
    mergeMeCache(null, { message: 'user updated is 1' }),
    null,
);

// ------------------------------------------------------------- isOwnMessage
check('mine: null current user owns nothing', isOwnMessage(null, 2), false);
check('mine: string current user + numeric sender', isOwnMessage('2' as never, 2), true);
check('mine: numeric current user + string sender', isOwnMessage(2, '2' as never), true);
check('mine: number === number', isOwnMessage(2, 2), true);
check('mine: other sender is not mine', isOwnMessage(2, 3), false);
check('mine: placeholder sender (-1) is not mine', isOwnMessage(2, -1), false);
check('mine: missing sender is not mine', isOwnMessage(2, undefined), false);

// The ORIGINAL bug on main: a numeric sender id compared to a string cache id.
check(
    'regression: number === string id comparison fails (the bug)',
    Number(2) === ('2' as unknown),
    false,
);

// ---------------------------------------------------------- access token sub
check('JWT sub as number', accessTokenSubject(tokenWithPayload({ sub: 2 })), 2);
check('JWT sub as string', accessTokenSubject(tokenWithPayload({ sub: '2', role: 'user' })), 2);
check('missing token', accessTokenSubject(null), null);
check('garbage token', accessTokenSubject('not-a-jwt'), null);
check('JWT without sub', accessTokenSubject(tokenWithPayload({ role: 'user' })), null);

console.log(
    failures === 0
        ? '\nAll identity checks passed.'
        : `\n${failures} identity check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
