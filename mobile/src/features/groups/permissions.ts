/**
 * Group admin permissions — the app's single source of truth, mirrored from
 * the backend contract (`group-permissions.util.ts`). The server remains the
 * authority; these constants only drive labels and the editor.
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

export type GroupPermissionKey = (typeof GROUP_PERMISSIONS)[number];

export interface GroupPermissionMeta {
    key: GroupPermissionKey;
    /** English title (primary row label). */
    en: string;
    /** Persian label (small muted subtitle, RTL). */
    fa: string;
    description: string;
    /** `false`: storable/editable but no feature enforces it yet. */
    active: boolean;
    implies: GroupPermissionKey[];
}

export const PERMISSION_META: Record<GroupPermissionKey, GroupPermissionMeta> =
    {
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
            description: 'Mute or restrict members. Not available yet.',
            active: false,
            implies: [],
        },
        manage_voice_chats: {
            key: 'manage_voice_chats',
            en: 'Manage Voice Chats',
            fa: 'مدیریت چت صوتی',
            description: 'Manage voice chats. Not available yet.',
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

export type GroupRoleName = 'owner' | 'admin' | 'member';

const LEGACY_ALIASES: Record<string, GroupPermissionKey> = {
    change_info_chat: 'edit_group_info',
    ban_user: 'ban_users',
    delete_message: 'delete_other_messages',
    pin_message: 'pin_messages',
};

export function isGroupPermissionKey(
    value: unknown,
): value is GroupPermissionKey {
    return (
        typeof value === 'string' &&
        (GROUP_PERMISSIONS as readonly string[]).includes(value)
    );
}

/** Migrates legacy names and drops unknown entries. `all` is preserved. */
export function normalizePermissions(
    values: readonly unknown[] | null | undefined,
): string[] {
    const result: string[] = [];
    for (const value of values ?? []) {
        if (typeof value !== 'string') continue;
        const normalized =
            value === 'all' ? 'all' : (LEGACY_ALIASES[value] ?? value);
        if (normalized !== 'all' && !isGroupPermissionKey(normalized)) continue;
        if (!result.includes(normalized)) result.push(normalized);
    }
    return result;
}

/** Explicit keys only (no `all` wildcard). */
export function explicitPermissions(
    values: readonly unknown[] | null | undefined,
): GroupPermissionKey[] {
    return normalizePermissions(values).filter(isGroupPermissionKey);
}

export function hasPermission(
    role: GroupRoleName | null | undefined,
    permissions: readonly unknown[] | null | undefined,
    key: GroupPermissionKey,
): boolean {
    if (role === 'owner') return true;
    const normalized = normalizePermissions(permissions);
    // `all` ("Full admin") only counts for admins; explicit grants stay
    // role-agnostic (a member may hold `pin_messages`).
    if (normalized.includes('all') && role === 'admin') return true;
    return normalized.some((permission) => {
        if (!isGroupPermissionKey(permission)) return false;
        return (
            permission === key ||
            PERMISSION_META[permission].implies.includes(key)
        );
    });
}

/** Which grants the editor may offer for the caller. */
export function grantablePermissions(
    role: GroupRoleName,
    callerPermissions: readonly unknown[] | null | undefined,
): GroupPermissionKey[] {
    if (role === 'owner') return [...GROUP_PERMISSIONS];
    return GROUP_PERMISSIONS.filter((key) =>
        hasPermission(role, callerPermissions, key),
    );
}

/** The permission whose `implies` covers `key`, if any. */
export function impliedBy(
    key: GroupPermissionKey,
    selected: readonly GroupPermissionKey[],
): GroupPermissionKey | null {
    for (const permission of selected) {
        if (permission === key) continue;
        if (PERMISSION_META[permission].implies.includes(key)) {
            return permission;
        }
    }
    return null;
}

/** Effective switch state: selected directly or implied by another grant. */
export function isPermissionEffective(
    key: GroupPermissionKey,
    selected: readonly GroupPermissionKey[],
): boolean {
    return selected.includes(key) || impliedBy(key, selected) !== null;
}

export type PresetKey = 'moderator' | 'manager' | 'full' | 'none';

export interface PermissionPreset {
    key: PresetKey;
    label: string;
    permissions: GroupPermissionKey[];
}

export const PERMISSION_PRESETS: readonly PermissionPreset[] = [
    {
        key: 'moderator',
        label: 'Moderator',
        permissions: [
            'delete_other_messages',
            'ban_users',
            'remove_members',
            'pin_messages',
            'restrict_members',
        ],
    },
    {
        key: 'manager',
        label: 'Manager',
        permissions: GROUP_PERMISSIONS.filter(
            (key) => key !== 'manage_admins' && key !== 'manage_permissions',
        ),
    },
    {
        key: 'full',
        label: 'Full admin',
        permissions: [...GROUP_PERMISSIONS],
    },
    { key: 'none', label: 'None', permissions: [] },
];

/** Compact summary under an admin name in the members list. */
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

export function permissionSetEquals(
    left: readonly GroupPermissionKey[],
    right: readonly GroupPermissionKey[],
): boolean {
    const a = new Set(left);
    const b = new Set(right);
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
}

export function togglePermissionSelection(
    current: readonly GroupPermissionKey[],
    key: GroupPermissionKey,
): GroupPermissionKey[] {
    return current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key];
}

/**
 * Adds `resource ids` to the payload `ChatAccess` expects. The editor mirrors
 * the server rules for interaction only; every save is re-checked server-side.
 */
export interface PermissionCaller {
    role: GroupRoleName;
    permissions: readonly GroupPermissionKey[];
    userId: number | null;
}

export interface PermissionTarget {
    role: GroupRoleName;
    promotedById: number | null;
}

// ── member (group-wide) permission policy ─────────────────────────────────
//
// Separate from the ADMIN grants above: these switches say what REGULAR
// MEMBERS may do in one group. The backend stores them on the group and
// enforces them at every operation boundary; the app mirrors the labels and
// defaults only.

export const GROUP_MEMBER_PERMISSIONS = [
    'send_messages',
    'send_media',
    'send_files',
    'send_voice',
    'send_links',
    'add_members',
    'invite_via_link',
    'pin_messages',
    'edit_own_messages',
    'delete_own_messages',
] as const;

export type GroupMemberPermissionKey =
    (typeof GROUP_MEMBER_PERMISSIONS)[number];

export type GroupMemberPermissionGroup =
    | 'messaging'
    | 'participation'
    | 'message_management';

export interface GroupMemberPermissionMeta {
    key: GroupMemberPermissionKey;
    group: GroupMemberPermissionGroup;
    title: string;
    description: string;
}

export const GROUP_MEMBER_PERMISSION_META: Record<
    GroupMemberPermissionKey,
    GroupMemberPermissionMeta
> = {
    send_messages: {
        key: 'send_messages',
        group: 'messaging',
        title: 'Send Messages',
        description: 'Send text messages in this group.',
    },
    send_media: {
        key: 'send_media',
        group: 'messaging',
        title: 'Send Media',
        description: 'Send photos and videos.',
    },
    send_files: {
        key: 'send_files',
        group: 'messaging',
        title: 'Send Files',
        description: 'Send documents and other files.',
    },
    send_voice: {
        key: 'send_voice',
        group: 'messaging',
        title: 'Send Voice',
        description: 'Send voice messages.',
    },
    send_links: {
        key: 'send_links',
        group: 'messaging',
        title: 'Send Links',
        description: 'Send messages that contain links.',
    },
    add_members: {
        key: 'add_members',
        group: 'participation',
        title: 'Add Members',
        description: 'Add people to the group directly.',
    },
    invite_via_link: {
        key: 'invite_via_link',
        group: 'participation',
        title: 'Invite via Link',
        description: 'Create, use and share group invite links.',
    },
    pin_messages: {
        key: 'pin_messages',
        group: 'message_management',
        title: 'Pin Messages',
        description: 'Pin and unpin messages.',
    },
    edit_own_messages: {
        key: 'edit_own_messages',
        group: 'message_management',
        title: 'Edit Own Messages',
        description: 'Edit the messages they sent.',
    },
    delete_own_messages: {
        key: 'delete_own_messages',
        group: 'message_management',
        title: 'Delete Own Messages',
        description: 'Delete the messages they sent.',
    },
};

export const DEFAULT_GROUP_MEMBER_PERMISSIONS: Readonly<
    Record<GroupMemberPermissionKey, boolean>
> = Object.freeze({
    send_messages: true,
    send_media: true,
    send_files: true,
    send_voice: true,
    send_links: true,
    add_members: false,
    invite_via_link: true,
    pin_messages: false,
    edit_own_messages: true,
    delete_own_messages: true,
});

export interface GroupMemberPermissionSection {
    key: GroupMemberPermissionGroup;
    title: string;
    permissions: readonly GroupMemberPermissionKey[];
}

export const GROUP_MEMBER_PERMISSION_SECTIONS: readonly GroupMemberPermissionSection[] =
    [
        {
            key: 'messaging',
            title: 'Messaging',
            permissions: [
                'send_messages',
                'send_media',
                'send_files',
                'send_voice',
                'send_links',
            ],
        },
        {
            key: 'participation',
            title: 'Group Participation',
            permissions: ['add_members', 'invite_via_link'],
        },
        {
            key: 'message_management',
            title: 'Message Management',
            permissions: [
                'pin_messages',
                'edit_own_messages',
                'delete_own_messages',
            ],
        },
    ];

export function isGroupMemberPermissionKey(
    value: unknown,
): value is GroupMemberPermissionKey {
    return (
        typeof value === 'string' &&
        (GROUP_MEMBER_PERMISSIONS as readonly string[]).includes(value)
    );
}

/** Complete config with the centralized defaults filling malformed values. */
export function normalizeGroupMemberPermissions(
    raw: unknown,
): Record<GroupMemberPermissionKey, boolean> {
    const source =
        raw !== null && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
    const result = {
        ...DEFAULT_GROUP_MEMBER_PERMISSIONS,
    } as Record<GroupMemberPermissionKey, boolean>;
    for (const key of GROUP_MEMBER_PERMISSIONS) {
        if (typeof source[key] === 'boolean') {
            result[key] = source[key];
        }
    }
    return result;
}

/** Three states of an individual override; `inherit` means the group default. */
export const MEMBER_PERMISSION_OVERRIDE_STATES = [
    'inherit',
    'allow',
    'deny',
] as const;

export type MemberPermissionOverrideState =
    (typeof MEMBER_PERMISSION_OVERRIDE_STATES)[number];

export type MemberPermissionOverrideMap = Record<
    GroupMemberPermissionKey,
    MemberPermissionOverrideState
>;

export function normalizeMemberPermissionOverrides(
    raw: unknown,
): MemberPermissionOverrideMap {
    const source =
        raw !== null && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
    const result = {} as MemberPermissionOverrideMap;
    for (const key of GROUP_MEMBER_PERMISSIONS) {
        const value = source[key];
        result[key] = value === 'allow' || value === 'deny' ? value : 'inherit';
    }
    return result;
}

/** Icon/label helper for the three-state selector. */
export function memberPermissionOverrideLabel(
    state: MemberPermissionOverrideState,
): string {
    return state === 'inherit'
        ? 'Inherit'
        : state === 'allow'
          ? 'Allow'
          : 'Deny';
}
