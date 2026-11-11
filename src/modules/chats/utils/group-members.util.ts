import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';

/**
 * Wire role of a group member. `owner` is the member holding the `manager`
 * role; `admin` and `member` map to the matching seeded roles. `ban` has no
 * group role (banned rows never appear in the panel or the counts).
 */
export type GroupRole = 'owner' | 'admin' | 'member';

export const GROUP_ROLE_RANK: Record<GroupRole, number> = {
    owner: 3,
    admin: 2,
    member: 1,
};

/** Highest first; plain member is the lowest visible role. */
export function toGroupRole(
    roleName: RoleChatEnum | string | null | undefined,
): GroupRole | null {
    switch (roleName) {
        case RoleChatEnum.MANAGER:
            return 'owner';
        case RoleChatEnum.ADMIN:
            return 'admin';
        case RoleChatEnum.USER:
            return 'member';
        default:
            return null;
    }
}

export function roleRank(
    roleName: RoleChatEnum | string | null | undefined,
): number {
    const role = toGroupRole(roleName);
    return role === null ? 0 : GROUP_ROLE_RANK[role];
}

/** The slice of the caller context the pure rules need. */
export interface GroupCallerRules {
    isOwner: boolean;
    isAdmin: boolean;
    permissions: PermissionChatEnum[];
}

/** The three admin permissions the owner may edit from the panel. */
export const EDITABLE_ADMIN_PERMISSIONS = [
    PermissionChatEnum.BAN_USER,
    PermissionChatEnum.DELETE_MESSAGE,
    PermissionChatEnum.CHANGE_INFO_CHAT,
] as const;

export type EditableAdminPermission =
    (typeof EDITABLE_ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_OPTIONS: ReadonlyArray<{
    key: EditableAdminPermission;
    label: string;
}> = [
    { key: PermissionChatEnum.BAN_USER, label: 'Remove members' },
    { key: PermissionChatEnum.DELETE_MESSAGE, label: 'Delete messages' },
    { key: PermissionChatEnum.CHANGE_INFO_CHAT, label: 'Edit group info' },
];

export interface GroupMemberActions {
    canPromote: boolean;
    canDemote: boolean;
    canRemove: boolean;
    canEditPermissions: boolean;
}

/**
 * Owner: promote a member, demote an admin, remove admins and members.
 * Admin: remove a regular member only, and only with `ban_user` or `all`.
 * Nobody (including the owner) may act on the owner or on themselves — the
 * role comparison already excludes self: an owner target is `owner`, an
 * admin's own row is `admin`, a member has no rights.
 */
export function canPromote(
    caller: GroupCallerRules,
    target: GroupRole,
): boolean {
    return caller.isOwner && target === 'member';
}

export function canDemote(
    caller: GroupCallerRules,
    target: GroupRole,
): boolean {
    return caller.isOwner && target === 'admin';
}

/** Only the owner may read/change an admin's permission set. */
export function canEditPermissions(
    caller: GroupCallerRules,
    target: GroupRole,
): boolean {
    return caller.isOwner && target === 'admin';
}

export function canRemove(
    caller: GroupCallerRules,
    target: GroupRole,
): boolean {
    if (target === 'owner') return false;
    if (caller.isOwner) return true;
    if (!caller.isAdmin) return false;
    if (target !== 'member') return false;
    return (
        caller.permissions.includes(PermissionChatEnum.BAN_USER) ||
        caller.permissions.includes(PermissionChatEnum.ALL)
    );
}

/** Exactly the three flags the members list exposes per row. */
export function memberActions(
    caller: GroupCallerRules,
    target: GroupRole,
): GroupMemberActions {
    return {
        canPromote: canPromote(caller, target),
        canDemote: canDemote(caller, target),
        canRemove: canRemove(caller, target),
        canEditPermissions: canEditPermissions(caller, target),
    };
}

/**
 * Strict body validation for the permission editor: an optional list (max 3)
 * of unique editable names. `all` and unknown names are rejected, not coerced.
 * Returns null for an invalid payload.
 */
export function parseEditablePermissions(
    input: unknown,
): EditableAdminPermission[] | null {
    if (!Array.isArray(input) || input.length > 3) return null;
    const result: EditableAdminPermission[] = [];
    for (const raw of input) {
        if (typeof raw !== 'string') return null;
        if (!(EDITABLE_ADMIN_PERMISSIONS as readonly string[]).includes(raw)) {
            return null;
        }
        const permission = raw as EditableAdminPermission;
        if (result.includes(permission)) return null;
        result.push(permission);
    }
    return result;
}

/** Order-insensitive set equality (duplicates already rejected above). */
export function samePermissionSet(
    left: readonly string[],
    right: readonly string[],
): boolean {
    const a = new Set(left);
    const b = new Set(right);
    if (a.size !== b.size) return false;
    for (const value of a) {
        if (!b.has(value)) return false;
    }
    return true;
}

/** Escape user input for a `LIKE`/`ILIKE` pattern (`\`, `%` and `_`). */
export function escapeLikeTerm(term: string): string {
    return term.replace(/[\\%_]/g, '\\$&');
}

const CURSOR_VERSION = 'v1';

/** Opaque keyset cursor: role rank (descending) + member id (ascending). */
export function encodeMemberCursor(rank: number, memberId: number): string {
    return Buffer.from(
        `${CURSOR_VERSION}:${rank}:${memberId}`,
        'utf8',
    ).toString('base64url');
}

export function decodeMemberCursor(
    cursor: string,
): { rank: number; memberId: number } | null {
    try {
        const text = Buffer.from(cursor, 'base64url').toString('utf8');
        const [version, rawRank, rawId] = text.split(':');
        if (version !== CURSOR_VERSION) return null;
        const rank = Number(rawRank);
        const memberId = Number(rawId);
        if (!Number.isInteger(rank) || !Number.isInteger(memberId)) return null;
        if (rank < 1 || rank > 3 || memberId <= 0) return null;
        return { rank, memberId };
    } catch {
        return null;
    }
}

export interface DedupableMemberRow {
    memberId: number;
    userId: number;
    role: GroupRole;
}

/**
 * One row per user, keeping the highest-ranking row (lowest member id wins a
 * tie). Duplicate `(chatId, userId)` rows exist in production data.
 */
export function dedupeMembersByUser<T extends DedupableMemberRow>(
    rows: T[],
): T[] {
    const best = new Map<number, T>();
    for (const row of rows) {
        const current = best.get(row.userId);
        if (current === undefined) {
            best.set(row.userId, row);
            continue;
        }
        const rowRank = GROUP_ROLE_RANK[row.role];
        const currentRank = GROUP_ROLE_RANK[current.role];
        if (
            rowRank > currentRank ||
            (rowRank === currentRank && row.memberId < current.memberId)
        ) {
            best.set(row.userId, row);
        }
    }
    return [...best.values()];
}

/** Panel ordering: owner, admins, members; then member id ascending. */
export function compareMembersForList(
    a: DedupableMemberRow,
    b: DedupableMemberRow,
): number {
    const rank = GROUP_ROLE_RANK[b.role] - GROUP_ROLE_RANK[a.role];
    return rank !== 0 ? rank : a.memberId - b.memberId;
}

export function sortMembersForList<T extends DedupableMemberRow>(
    rows: T[],
): T[] {
    return [...rows].sort(compareMembersForList);
}
