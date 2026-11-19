import { RoleChatEnum } from 'src/common/enums/roleChat.enum';

/**
 * Admin permissions — the ONE source of truth for storage names, labels,
 * implications and legacy migration.
 *
 * Storage keeps its existing shape: `permission_admin` rows pointing at
 * `permission_chats.name`. `all` remains a wildcard meaning every permission.
 */

export const GROUP_PERMISSIONS = [
    'edit_group_info',
    'manage_members',
    'remove_members',
    'ban_users',
    'manage_invites',
    'pin_messages',
    'delete_other_messages',
    'manage_messages',
    'restrict_members',
    'manage_voice_chats',
    'manage_admins',
    'manage_permissions',
] as const;

export type GroupPermission = (typeof GROUP_PERMISSIONS)[number];

/** A stored value: one of the 12 keys or the `all` wildcard. */
export type GroupPermissionInput = GroupPermission | 'all';

/** Wire role used by the permission helpers. */
export type GroupRoleName = 'owner' | 'admin' | 'member';

/** Old value → new key. `all` stays `all`. */
export const LEGACY_PERMISSION_ALIASES: Readonly<
    Record<string, GroupPermission>
> = {
    change_info_chat: 'edit_group_info',
    ban_user: 'ban_users',
    delete_message: 'delete_other_messages',
    pin_message: 'pin_messages',
};

export interface PermissionMeta {
    key: GroupPermission;
    en: string;
    fa: string;
    description: string;
    /** `false` = storable/editable but no feature enforces it yet. */
    active: boolean;
    /** Permissions this key grants implicitly. */
    implies: GroupPermission[];
}

export const PERMISSION_META: Readonly<
    Record<GroupPermission, PermissionMeta>
> = {
    edit_group_info: {
        key: 'edit_group_info',
        en: 'Edit Group Info',
        fa: 'ویرایش اطلاعات گروه',
        description: "Change the group's title, description and photos.",
        active: true,
        implies: [],
    },
    manage_members: {
        key: 'manage_members',
        en: 'Manage Members',
        fa: 'مدیریت اعضا',
        description: 'Add people to the group and see every member role.',
        active: true,
        implies: [],
    },
    remove_members: {
        key: 'remove_members',
        en: 'Remove Members',
        fa: 'حذف اعضا',
        description: 'Remove regular members from the group.',
        active: true,
        implies: [],
    },
    ban_users: {
        key: 'ban_users',
        en: 'Ban Users',
        fa: 'مسدود کردن کاربران',
        description: 'Ban, unban and review banned users.',
        active: true,
        implies: [],
    },
    manage_invites: {
        key: 'manage_invites',
        en: 'Manage Invites',
        fa: 'مدیریت دعوت‌ها',
        description: 'Create, list and revoke invite links.',
        active: true,
        implies: [],
    },
    pin_messages: {
        key: 'pin_messages',
        en: 'Pin Messages',
        fa: 'سنجاق کردن پیام‌ها',
        description: 'Pin and unpin messages in the group.',
        active: true,
        implies: [],
    },
    delete_other_messages: {
        key: 'delete_other_messages',
        en: 'Delete Other Messages',
        fa: 'حذف پیام دیگران',
        description: 'Delete messages written by other members.',
        active: true,
        implies: [],
    },
    manage_messages: {
        key: 'manage_messages',
        en: 'Manage Messages',
        fa: 'مدیریت پیام‌ها',
        description:
            'Moderate messages. Includes deleting others’ messages and pinning.',
        active: true,
        implies: ['delete_other_messages', 'pin_messages'],
    },
    restrict_members: {
        key: 'restrict_members',
        en: 'Restrict Members',
        fa: 'محدود کردن دسترسی اعضا',
        description: 'Mute or restrict members. No feature enforces it yet.',
        active: false,
        implies: [],
    },
    manage_voice_chats: {
        key: 'manage_voice_chats',
        en: 'Manage Voice Chats',
        fa: 'مدیریت چت صوتی',
        description: 'Manage voice chats. No feature enforces it yet.',
        active: false,
        implies: [],
    },
    manage_admins: {
        key: 'manage_admins',
        en: 'Manage Admins',
        fa: 'مدیریت ادمین‌ها',
        description: 'Promote members to admin and demote admins.',
        active: true,
        implies: [],
    },
    manage_permissions: {
        key: 'manage_permissions',
        en: 'Manage Permissions',
        fa: 'مدیریت پرمیژن‌ها',
        description: "Edit an admin's permission set.",
        active: true,
        implies: [],
    },
};

export const ALL_PERMISSIONS: readonly GroupPermission[] = GROUP_PERMISSIONS;

export const INACTIVE_PERMISSIONS: readonly GroupPermission[] =
    GROUP_PERMISSIONS.filter((key) => !PERMISSION_META[key].active);

/**
 * Normalizes one stored/permission-editor value to a contract value.
 * Legacy names map to their new key, `all` is preserved, anything else is
 * unknown (`null`).
 */
export function normalizePermissionName(
    raw: unknown,
): GroupPermissionInput | null {
    if (typeof raw !== 'string') return null;
    if (raw === 'all') return 'all';
    const legacy = LEGACY_PERMISSION_ALIASES[raw];
    if (legacy !== undefined) return legacy;
    return (GROUP_PERMISSIONS as readonly string[]).includes(raw)
        ? (raw as GroupPermission)
        : null;
}

/**
 * Normalizes a stored grant list: known names only, legacy names migrated,
 * duplicates removed. `all` is preserved as the wildcard.
 */
export function normalizePermissions(
    raw: readonly unknown[] | null | undefined,
): GroupPermissionInput[] {
    const result: GroupPermissionInput[] = [];
    for (const value of raw ?? []) {
        const normalized = normalizePermissionName(value);
        if (normalized === null) continue;
        if (!result.includes(normalized)) result.push(normalized);
    }
    return result;
}

/** Normalized keys without the `all` wildcard (for display/editing). */
export function explicitPermissions(
    raw: readonly unknown[] | null | undefined,
): GroupPermission[] {
    return normalizePermissions(raw).filter(
        (value): value is GroupPermission => value !== 'all',
    );
}

/** True for the `admin` group role (`manager` is the owner). */
export function isAdminRole(
    role: GroupRoleName | RoleChatEnum | null | undefined,
): boolean {
    return role !== null && role !== undefined && String(role) === 'admin';
}

/**
 * Effective permission check. The owner has everything; `all` implies every
 * key; `implies` (e.g. manage_messages ⇒ delete_other_messages) is resolved
 * here so no caller re-implements it.
 *
 * The `all` wildcard is the "Full admin" grant and only counts for admins:
 * a stray wildcard row on a plain member must never escalate capabilities.
 * Explicit grants stay role-agnostic (a member may hold `pin_messages`).
 */
export function hasPermission(
    role: GroupRoleName | RoleChatEnum | null | undefined,
    permissions: readonly unknown[] | null | undefined,
    key: GroupPermission,
): boolean {
    if (role === 'owner' || role === RoleChatEnum.MANAGER) return true;
    const normalized = normalizePermissions(permissions);
    if (normalized.includes('all') && isAdminRole(role)) return true;
    for (const permission of normalized) {
        if (permission === key) return true;
        if (
            permission !== 'all' &&
            PERMISSION_META[permission].implies.includes(key)
        ) {
            return true;
        }
    }
    return false;
}

/** True when every desired key is covered by the granter's own permissions. */
export function canGrantPermissions(
    role: GroupRoleName | RoleChatEnum | null | undefined,
    granterPermissions: readonly unknown[] | null | undefined,
    desired: readonly GroupPermission[],
): boolean {
    if (role === 'owner') return true;
    return desired.every((key) => hasPermission(role, granterPermissions, key));
}

export interface ParsedPermissions {
    /** `all` was requested (owner-only). */
    all: boolean;
    /** Deduplicated known keys, without `all`. */
    keys: GroupPermission[];
}

/**
 * Validates an editor payload: an array of known keys (legacy names accepted
 * and normalized). Duplicates are removed. `null` means an unknown key or a
 * non-array payload (→ 400). `all` is reported separately so the service can
 * enforce that only the owner may grant it.
 */
export function parsePermissionsInput(
    input: unknown,
): ParsedPermissions | null {
    if (!Array.isArray(input)) return null;
    const keys: GroupPermission[] = [];
    let all = false;
    for (const raw of input) {
        const normalized = normalizePermissionName(raw);
        if (normalized === null) return null;
        if (normalized === 'all') {
            all = true;
            continue;
        }
        if (!keys.includes(normalized)) keys.push(normalized);
    }
    return { all, keys };
}

/** Human summary used by the members list ("Full admin" / "3 permissions"). */
export function permissionSummary(
    role: GroupRoleName,
    permissions: readonly unknown[] | null | undefined,
): string | null {
    if (role !== 'admin') return null;
    const normalized = normalizePermissions(permissions);
    if (normalized.includes('all')) return 'Full admin';
    const count = normalized.length;
    if (count === 0) return 'No permissions';
    return count === 1 ? '1 permission' : `${count} permissions`;
}
