import type { UserDto } from '../../core/api';
import { toNumericId } from '../messages/messages-model';

/**
 * The `['me']` cache must always hold a COMPLETE `UserDto` (the
 * `GET /auth/getme` shape) whose `id` is a number.
 *
 * Profile endpoints are inconsistent about their envelope: `getme` is a bare
 * `toUserResponse`, avatar mutations answer `{ message, user }`, lookups answer
 * `{ data: user }`, and `PUT /user/updateme` answers `{ message }` only. Every
 * cache write therefore goes through these helpers; nothing partial is stored.
 */

/** Unwrapped user of any profile response envelope, normalized; null if incomplete. */
export function normalizeUserPayload(raw: unknown): UserDto | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const nested = record['user'] ?? record['data'];
    const candidate =
        nested !== null && typeof nested === 'object' && !Array.isArray(nested)
            ? (nested as Record<string, unknown>)
            : record;
    const id = toNumericId(candidate['id']);
    if (id === null) {
        // `{ message }`, an error body, etc. — never a user.
        return null;
    }
    return { ...(candidate as unknown as UserDto), id };
}

/**
 * `{ ...previous, ...normalized(response) }`: a partial or differently shaped
 * response can never wipe the cached user, and the id never changes. Returns
 * `null` only when there is nothing (complete) to write at all.
 */
export function mergeMeCache(
    previous: UserDto | null,
    raw: unknown,
): UserDto | null {
    const incoming = normalizeUserPayload(raw);
    if (previous === null) {
        return incoming;
    }
    if (incoming === null) {
        return previous;
    }
    return {
        ...previous,
        ...incoming,
        id: toNumericId(previous.id) ?? incoming.id,
    };
}
