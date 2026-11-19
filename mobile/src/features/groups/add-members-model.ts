import type { SavedContactItem } from '../contacts/contacts-model';
import type { AddMemberFailure, AddMembersResult } from './group-model';

/**
 * Pure shaping for the "Add from Contacts" step.
 *
 * The source is the SAVED contacts list (`GET /contacts`) — never the device
 * address book. Contacts already in the group stay visible but are disabled,
 * so the caller sees who is already there instead of a silently shorter list.
 */

export interface AddContactOption {
    /** Public NiazChat user id (the id shown on profile screens). */
    userId: number;
    /** Alias when set, otherwise the account name. */
    displayName: string;
    /** Account display name (kept so search matches it under an alias). */
    accountName: string;
    username: string | null;
    avatarUrl: string | null;
    /** Already an active member of the group. */
    isMember: boolean;
}

/**
 * The public User ID to display for a contact, or `null` when it is missing or
 * unusable. Only `userId` (the profile id) is ever public; saved-contact row
 * ids never reach this helper.
 */
export function publicUserIdLabel(
    userId: number | null | undefined,
): string | null {
    if (userId === null || userId === undefined) return null;
    const value = Number(userId);
    return Number.isInteger(value) && value > 0 ? String(value) : null;
}

const collator = new Intl.Collator('fa', {
    sensitivity: 'base',
    numeric: true,
});

/** Saves-first display name: alias, then the account name. */
export function buildAddContactOptions(
    contacts: readonly SavedContactItem[],
    memberIds: ReadonlySet<number>,
): AddContactOption[] {
    const seen = new Set<number>();
    const options: AddContactOption[] = [];
    for (const contact of contacts) {
        const userId = Number(contact.userId);
        if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
            continue;
        }
        seen.add(userId);
        options.push({
            userId,
            displayName: contact.alias ?? contact.name,
            accountName: contact.name,
            username: contact.username,
            avatarUrl: contact.avatarUrl,
            isMember: memberIds.has(userId),
        });
    }
    return options.sort((left, right) =>
        collator.compare(left.displayName, right.displayName),
    );
}

/** Local filter across custom name, account name, username and user id. */
export function filterAddContactOptions(
    options: readonly AddContactOption[],
    query: string,
): AddContactOption[] {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [...options];
    return options.filter(
        (option) =>
            option.displayName.toLowerCase().includes(needle) ||
            option.accountName.toLowerCase().includes(needle) ||
            (option.username ?? '').toLowerCase().includes(needle) ||
            String(option.userId).includes(needle),
    );
}

/** Immutable toggle; adding an existing member is ignored. */
export function toggleContactSelection(
    selected: ReadonlySet<number>,
    userId: number,
): Set<number> {
    const next = new Set(selected);
    if (next.has(userId)) {
        next.delete(userId);
    } else {
        next.add(userId);
    }
    return next;
}

/** `null` when nothing is selected (the button is disabled). */
export function selectedCountLabel(count: number): string | null {
    if (count <= 0) return null;
    return count === 1 ? '1 selected' : `${count} selected`;
}

/** One-line result for the toast; the failure breakdown is in `failuresText`. */
export function addMembersFeedback(result: {
    added: readonly unknown[];
    failed: readonly unknown[];
}): string {
    const added = result.added.length;
    const failed = result.failed.length;
    if (added === 0 && failed === 0) return 'No changes';
    if (failed === 0) {
        return added === 1 ? '1 member added' : `${added} members added`;
    }
    if (added === 0) {
        return failed === 1
            ? 'That person could not be added'
            : 'Nobody could be added';
    }
    return `${added} added · ${failed} not added`;
}

function failureLine(failure: AddMemberFailure): string {
    switch (failure.code) {
        case 'already_member':
            return 'already in the group';
        case 'banned':
            return 'banned from the group';
        case 'blocked':
            return 'not available';
        case 'not_found':
            return 'account not found';
    }
}

/** Compact per-code breakdown for the partial-success dialog. */
export function failuresText(failures: readonly AddMemberFailure[]): string {
    const labels = new Map<string, number>();
    for (const failure of failures) {
        const key = failureLine(failure);
        labels.set(key, (labels.get(key) ?? 0) + 1);
    }
    return [...labels.entries()]
        .map(([label, count]) => `${count} ${label}`)
        .join(' · ');
}

/** Batch cap mirror of the server (`MAX_ADD_MEMBERS_PER_REQUEST`). */
export const ADD_MEMBERS_BATCH_LIMIT = 50;

export function chunkUserIds(
    userIds: readonly number[],
    size: number = ADD_MEMBERS_BATCH_LIMIT,
): number[][] {
    const chunks: number[][] = [];
    for (let index = 0; index < userIds.length; index += size) {
        chunks.push(userIds.slice(index, index + size));
    }
    return chunks;
}

/** Merges batch responses so partial failures are reported once. */
export function mergeAddMembersResults(
    results: readonly AddMembersResult[],
): AddMembersResult {
    return results.reduce<AddMembersResult>(
        (merged, result) => ({
            added: [...merged.added, ...result.added],
            failed: [...merged.failed, ...result.failed],
            membersCount: result.membersCount,
        }),
        { added: [], failed: [], membersCount: 0 },
    );
}
