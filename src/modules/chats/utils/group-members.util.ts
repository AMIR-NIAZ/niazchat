import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import {
    GROUP_PERMISSIONS,
    hasPermission,
    PERMISSION_META,
} from './group-permissions.util';
import type { GroupPermission } from './group-permissions.util';

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
    permissions: PermissionChatEnum[] | string[];
    /** Caller's user id, for context that needs it. */
    userId?: number;
}

/** Extra target facts the `promotedById` rules need. */
export interface GroupTargetRules {
    /** User who promoted this admin (null for legacy/owner/member rows). */
    promotedById?: number | null;
    /** Caller's user id (falls back to `caller.userId`). */
    callerUserId?: number;
}

/** All 12 contract permissions the editor may grant. */
export const EDITABLE_ADMIN_PERMISSIONS: readonly GroupPermission[] =
    GROUP_PERMISSIONS;

export type EditableAdminPermission = GroupPermission;

export const ADMIN_PERMISSION_OPTIONS: ReadonlyArray<{
    key: EditableAdminPermission;
    label: string;
}> = GROUP_PERMISSIONS.map((key) => ({ key, label: PERMISSION_META[key].en }));

export interface GroupMemberActions {
    canPromote: boolean;
    canDemote: boolean;
    canRemove: boolean;
    canEditPermissions: boolean;
    canBan: boolean;
    /** Owner, or admin with `manage_permissions`, viewing a regular member. */
    canManageMemberPermissions: boolean;
}

function callerRole(caller: GroupCallerRules): 'owner' | 'admin' | 'member' {
    if (caller.isOwner) return 'owner';
    return caller.isAdmin ? 'admin' : 'member';
}

function can(caller: GroupCallerRules, key: GroupPermission): boolean {
    return hasPermission(callerRole(caller), caller.permissions, key);
}

/**
 * Promote: the owner always, an admin with `manage_admins`, plain members
 * only. Nobody promotes the owner or another admin.
 */
export function canPromote(
    caller: GroupCallerRules,
    target: GroupRole,
): boolean {
    if (target !== 'member') return false;
    return caller.isOwner || (caller.isAdmin && can(caller, 'manage_admins'));
}

/**
 * Demote: the owner may demote any admin. An admin with `manage_admins` may
 * demote only admins THEY promoted (`promotedById`). Never the owner.
 */
export function canDemote(
    caller: GroupCallerRules,
    target: GroupRole,
    options: GroupTargetRules = {},
): boolean {
    if (target !== 'admin') return false;
    if (caller.isOwner) return true;
    if (!caller.isAdmin || !can(caller, 'manage_admins')) return false;
    const callerId = options.callerUserId ?? caller.userId ?? null;
    return (
        callerId !== null &&
        options.promotedById !== null &&
        options.promotedById !== undefined &&
        Number(options.promotedById) === Number(callerId)
    );
}

/**
 * Edit an admin's permission set: the owner always; an admin with
 * `manage_permissions` may edit only admins THEY promoted.
 */
export function canEditPermissions(
    caller: GroupCallerRules,
    target: GroupRole,
    options: GroupTargetRules = {},
): boolean {
    if (target !== 'admin') return false;
    if (caller.isOwner) return true;
    if (!caller.isAdmin || !can(caller, 'manage_permissions')) return false;
    const callerId = options.callerUserId ?? caller.userId ?? null;
    return (
        callerId !== null &&
        options.promotedById !== null &&
        options.promotedById !== undefined &&
        Number(options.promotedById) === Number(callerId)
    );
}

/**
 * Remove: the owner removes members and admins. An admin with
 * `remove_members` removes plain members only.
 */
export function canRemove(
    caller: GroupCallerRules,
    target: GroupRole,
): boolean {
    if (target === 'owner') return false;
    if (caller.isOwner) return true;
    if (!caller.isAdmin) return false;
    if (target !== 'member') return false;
    return can(caller, 'remove_members');
}

/**
 * Ban: the owner bans members and admins; an admin with `ban_users` bans
 * plain members only. Nobody bans the owner. The caller's own row carries
 * their own role, so self-ban is excluded structurally (owner target →
 * rejected, admin target → admin-needs-member rule).
 */
export function canBan(caller: GroupCallerRules, target: GroupRole): boolean {
    if (target === 'owner') return false;
    if (caller.isOwner) return true;
    if (!caller.isAdmin) return false;
    if (target !== 'member') return false;
    return can(caller, 'ban_users');
}

/** Exactly the flags the members list exposes per row. */
export function memberActions(
    caller: GroupCallerRules,
    target: GroupRole,
    options: GroupTargetRules = {},
): GroupMemberActions {
    return {
        canPromote: canPromote(caller, target),
        canDemote: canDemote(caller, target, options),
        canRemove: canRemove(caller, target),
        canEditPermissions: canEditPermissions(caller, target, options),
        canBan: canBan(caller, target),
        // Individual overrides only exist for plain members; owners/admins keep
        // their role-based power, so there is nothing to override there.
        canManageMemberPermissions:
            target === 'member' &&
            (caller.isOwner ||
                (caller.isAdmin && can(caller, 'manage_permissions'))),
    };
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
