/**
 * Pure helpers for "Add members": one request may carry a bounded batch, and
 * ids are normalized exactly once before any database work.
 */

/** Server-side cap for ONE add-members request (not a group capacity). */
export const MAX_ADD_MEMBERS_PER_REQUEST = 50;

/**
 * Validates + deduplicates the requested user ids.
 *
 * `null` means the payload is unusable (not an array, empty, above the batch
 * cap, or containing a value that is not a positive integer).
 */
export function normalizeAddMemberIds(raw: unknown): number[] | null {
    if (!Array.isArray(raw)) return null;
    if (raw.length === 0 || raw.length > MAX_ADD_MEMBERS_PER_REQUEST) {
        return null;
    }
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const value of raw) {
        const id = Number(value);
        if (!Number.isInteger(id) || id <= 0) return null;
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

/** Why one requested user could not be added (stable wire values). */
export type AddMemberFailureCode =
    | 'not_found'
    | 'already_member'
    | 'banned'
    | 'blocked';

export interface AddMemberFailure {
    userId: number;
    code: AddMemberFailureCode;
    message: string;
}

/** One user of one membership row, classified for the add operation. */
export function classifyMembership(
    rows: ReadonlyArray<{ role?: { name?: string | null } | null }>,
    banRole: string,
): 'none' | 'member' | 'banned' {
    if (rows.length === 0) return 'none';
    if (rows.every((row) => row.role?.name === banRole)) return 'banned';
    return 'member';
}
