/**
 * Defense-in-depth user/group sanitizers.
 *
 * Guards reject the "blocker profile" and "group I was banned from" reads, but
 * the same user can still be embedded in payloads the viewer legitimately
 * receives (message senders in shared groups, member lists, chat peers,
 * saved contacts, reactions). These helpers strip exactly the fields the
 * viewer must not see, while keeping `id` and `name` so old messages and rows
 * still render (a deleted-photo look).
 *
 * The generic shape keeps one implementation for every DTO: fields that are
 * absent are ignored, so a new projection cannot accidentally skip the
 * sanitizer because of a type mismatch.
 */

/** Fallback display name used by the backend for users without a profile name. */
export const HIDDEN_USER_NAME = 'بدون نام';

/**
 * Hides one user's details from a viewer who was blocked by that user.
 * `avatars` becomes `[]`, presence/bio/phone/username-derived fields are
 * removed or blanked, and `id`/`name` stay for rendering.
 */
export function sanitizeUserForViewer<T extends object>(
    value: T,
    hidden: boolean,
): T {
    if (!hidden) {
        return value;
    }
    const copy: Record<string, unknown> = {
        ...(value as Record<string, unknown>),
    };
    if ('avatars' in copy) {
        copy.avatars = [];
    }
    if ('biografy' in copy) {
        copy.biografy = null;
    }
    if ('description' in copy) {
        copy.description = null;
    }
    if ('alias' in copy) {
        copy.alias = null;
    }
    if ('phone' in copy) {
        delete copy.phone;
    }
    if ('status' in copy) {
        delete copy.status;
    }
    if ('isOnline' in copy) {
        copy.isOnline = false;
    }
    if ('lastSeen' in copy) {
        copy.lastSeen = null;
    }
    if ('username' in copy) {
        copy.username = copy.username === null ? null : '';
    }
    if ('name' in copy && (copy.name === undefined || copy.name === null)) {
        copy.name = HIDDEN_USER_NAME;
    }
    return copy as T;
}

/** Applies `sanitizeUserForViewer` to a list keyed by the user's id. */
export function sanitizeUsersForViewer<T extends object>(
    items: readonly T[],
    hiddenUserIds: ReadonlySet<number>,
    userIdOf: (item: T) => number,
): T[] {
    if (hiddenUserIds.size === 0) {
        return [...items];
    }
    return items.map((item) =>
        sanitizeUserForViewer(item, hiddenUserIds.has(userIdOf(item))),
    );
}

/**
 * Groups the viewer was banned from never expose their profile data. This is
 * the last line of defense for payloads that embed group fields (chat rows,
 * live group updates): a banned viewer receives neither photo nor description
 * nor member count.
 */
export function sanitizeGroupForViewer<
    T extends {
        avatars?: string[] | null;
        description?: string | null;
        membersCount?: number | null;
    },
>(value: T, hidden: boolean): T {
    if (!hidden) {
        return value;
    }
    return {
        ...value,
        ...(value.avatars === undefined ? {} : { avatars: [] }),
        ...(value.description === undefined ? {} : { description: null }),
        ...(value.membersCount === undefined ? {} : { membersCount: 0 }),
    };
}
