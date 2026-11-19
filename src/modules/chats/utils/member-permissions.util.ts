import type { AttachmentKind } from 'src/common/utils/attachment-kind.util';

/**
 * Group MEMBER permissions — what a REGULAR MEMBER (role `user`) may do inside
 * one group. This is deliberately separate from the admin permission contract
 * in `group-permissions.util.ts`:
 *
 *   - admin permissions (`permission_admin`) say what an admin may do;
 *   - member permissions (`chats.memberPermissions`) say what plain members
 *     may do. Owners always pass; admins keep using their own grant set.
 *
 * Every key is independently configurable; a disabled key is enforced by the
 * backend at the operation boundary (never by the mobile UI alone).
 */

export const MEMBER_PERMISSIONS = [
    // Messaging
    'send_messages',
    'send_media',
    'send_files',
    'send_voice',
    'send_links',
    // Group participation
    'add_members',
    'invite_via_link',
    // Message management
    'pin_messages',
    'edit_own_messages',
    'delete_own_messages',
] as const;

export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number];

/** Every member capability, as a validated boolean map. */
export type MemberPermissionsConfig = Record<MemberPermission, boolean>;

export type MemberPermissionGroup =
    | 'messaging'
    | 'participation'
    | 'message_management';

export interface MemberPermissionMeta {
    key: MemberPermission;
    group: MemberPermissionGroup;
    en: string;
    description: string;
}

/**
 * Centralized defaults for a NEW group and for existing rows after migration.
 * `send_*` are open, adding members and pinning are moderator-only.
 */
export const DEFAULT_MEMBER_PERMISSIONS: Readonly<MemberPermissionsConfig> =
    Object.freeze({
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

export const MEMBER_PERMISSION_META: Readonly<
    Record<MemberPermission, MemberPermissionMeta>
> = {
    send_messages: {
        key: 'send_messages',
        group: 'messaging',
        en: 'Send Messages',
        description: 'Send text messages in this group.',
    },
    send_media: {
        key: 'send_media',
        group: 'messaging',
        en: 'Send Media',
        description: 'Send photos and videos.',
    },
    send_files: {
        key: 'send_files',
        group: 'messaging',
        en: 'Send Files',
        description: 'Send documents and other files.',
    },
    send_voice: {
        key: 'send_voice',
        group: 'messaging',
        en: 'Send Voice',
        description: 'Send voice messages.',
    },
    send_links: {
        key: 'send_links',
        group: 'messaging',
        en: 'Send Links',
        description: 'Send messages that contain links.',
    },
    add_members: {
        key: 'add_members',
        group: 'participation',
        en: 'Add Members',
        description: 'Add people to this group directly.',
    },
    invite_via_link: {
        key: 'invite_via_link',
        group: 'participation',
        en: 'Invite via Link',
        description: 'Create, use and share group invite links.',
    },
    pin_messages: {
        key: 'pin_messages',
        group: 'message_management',
        en: 'Pin Messages',
        description: 'Pin and unpin messages.',
    },
    edit_own_messages: {
        key: 'edit_own_messages',
        group: 'message_management',
        en: 'Edit Own Messages',
        description: 'Edit the messages they sent.',
    },
    delete_own_messages: {
        key: 'delete_own_messages',
        group: 'message_management',
        en: 'Delete Own Messages',
        description: 'Delete the messages they sent.',
    },
};

export interface MemberPermissionSection {
    key: MemberPermissionGroup;
    title: string;
    permissions: readonly MemberPermission[];
}

/** Presentation order used by the mobile editor and the API docs. */
export const MEMBER_PERMISSION_SECTIONS: readonly MemberPermissionSection[] = [
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

export function isMemberPermission(value: unknown): value is MemberPermission {
    return (
        typeof value === 'string' &&
        (MEMBER_PERMISSIONS as readonly string[]).includes(value)
    );
}

/**
 * Coerces any stored/hand-edited value to the complete contract: known keys
 * with boolean values, every missing or malformed key filled from the
 * centralized defaults. This is the read path for rows written before a key
 * existed.
 */
export function normalizeMemberPermissions(
    raw: unknown,
): MemberPermissionsConfig {
    const source =
        raw !== null && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
    const result = { ...DEFAULT_MEMBER_PERMISSIONS } as MemberPermissionsConfig;
    for (const key of MEMBER_PERMISSIONS) {
        const value = source[key];
        if (typeof value === 'boolean') {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Validates a PATCH payload: a non-empty object whose keys are all contract
 * keys and whose values are booleans. `null` means "reject with 400" (unknown
 * key, non-boolean value or a non-object body).
 */
export function parseMemberPermissionsPatch(
    input: unknown,
): Partial<MemberPermissionsConfig> | null {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return null;
    }
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) return null;

    const patch: Partial<MemberPermissionsConfig> = {};
    for (const [key, value] of entries) {
        if (!isMemberPermission(key)) return null;
        if (typeof value !== 'boolean') return null;
        patch[key] = value;
    }
    return patch;
}

/** True when `patch` would change at least one stored value. */
export function memberPermissionsChanged(
    current: MemberPermissionsConfig,
    patch: Partial<MemberPermissionsConfig>,
): boolean {
    return (Object.keys(patch) as MemberPermission[]).some(
        (key) => current[key] !== patch[key],
    );
}

/** Applies a validated patch over the full config. */
export function mergeMemberPermissions(
    current: MemberPermissionsConfig,
    patch: Partial<MemberPermissionsConfig>,
): MemberPermissionsConfig {
    return { ...current, ...patch };
}

/**
 * The member permission that guards one attachment kind. Voice messages have
 * their own switch; images/videos are "media"; documents, music tracks and
 * everything else are "files".
 */
export function attachmentMemberPermission(
    kind: AttachmentKind,
): MemberPermission {
    switch (kind) {
        case 'image':
        case 'video':
            return 'send_media';
        case 'voice':
            return 'send_voice';
        default:
            return 'send_files';
    }
}

/**
 * Conservative link detection for message text: `http(s)://`, `www.` and bare
 * `domain.tld/...` hosts. The backend rejects the message when `send_links` is
 * off, so the check must not be easy to dodge with a bare domain.
 */
const LINK_PATTERN =
    /(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|me|ir|co|dev|app|link|xyz|info|edu|gov|ly|to|gg|tv|site|online)\b(?:\/\S*)?/i;

export function messageContainsLink(text: string | null | undefined): boolean {
    if (typeof text !== 'string' || text.trim() === '') return false;
    return LINK_PATTERN.test(text);
}

// ── individual member overrides ──────────────────────────────────────────
//
// The group config above is the DEFAULT for regular members. One optional row
// per (chat, user) stores a sparse tri-state override:
//   inherit → use the group default (never stored)
//   allow   → true even when the group default is false
//   deny    → false even when the group default is true

/** Exactly the three states exposed by the API and the mobile editor. */
export const MEMBER_PERMISSION_OVERRIDE_STATES = [
    'inherit',
    'allow',
    'deny',
] as const;

export type MemberPermissionOverrideState =
    (typeof MEMBER_PERMISSION_OVERRIDE_STATES)[number];

/** Compact state map (all keys) used by the API and the mobile cache. */
export type MemberPermissionOverrideMap = Record<
    MemberPermission,
    MemberPermissionOverrideState
>;

/** Only the explicit states are persisted; `inherit` keys are omitted. */
export type StoredMemberPermissionOverrides = Partial<
    Record<MemberPermission, 'allow' | 'deny'>
>;

export function isMemberPermissionOverrideState(
    value: unknown,
): value is MemberPermissionOverrideState {
    return (
        typeof value === 'string' &&
        (MEMBER_PERMISSION_OVERRIDE_STATES as readonly string[]).includes(value)
    );
}

/**
 * Read path for stored overrides: known keys with a valid explicit state are
 * kept, everything else (including `inherit`) becomes `inherit`.
 */
export function normalizeMemberPermissionOverrides(
    raw: unknown,
): MemberPermissionOverrideMap {
    const source =
        raw !== null && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
    const result = {} as MemberPermissionOverrideMap;
    for (const key of MEMBER_PERMISSIONS) {
        const value = source[key];
        result[key] = value === 'allow' || value === 'deny' ? value : 'inherit';
    }
    return result;
}

/** Drops `inherit` keys so only explicit allow/deny values hit the database. */
export function storedMemberPermissionOverrides(
    map: MemberPermissionOverrideMap,
): StoredMemberPermissionOverrides {
    const stored: StoredMemberPermissionOverrides = {};
    for (const key of MEMBER_PERMISSIONS) {
        const state = map[key];
        if (state === 'allow' || state === 'deny') stored[key] = state;
    }
    return stored;
}

/** True when nothing is explicitly overridden. */
export function isEmptyMemberPermissionOverrides(
    map: MemberPermissionOverrideMap,
): boolean {
    return MEMBER_PERMISSIONS.every((key) => map[key] === 'inherit');
}

/**
 * Validates a PATCH payload: a non-empty object of contract keys whose values
 * are `inherit`/`allow`/`deny`. `null` means reject with 400.
 */
export function parseMemberPermissionOverridesPatch(
    input: unknown,
): Partial<MemberPermissionOverrideMap> | null {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return null;
    }
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) return null;

    const patch: Partial<MemberPermissionOverrideMap> = {};
    for (const [key, value] of entries) {
        if (!isMemberPermission(key)) return null;
        if (!isMemberPermissionOverrideState(value)) return null;
        patch[key] = value;
    }
    return patch;
}

/** Field-wise merge; `inherit` resets that single key. */
export function mergeMemberPermissionOverrides(
    current: MemberPermissionOverrideMap,
    patch: Partial<MemberPermissionOverrideMap>,
): MemberPermissionOverrideMap {
    return { ...current, ...patch };
}

export function memberPermissionOverridesChanged(
    current: MemberPermissionOverrideMap,
    patch: Partial<MemberPermissionOverrideMap>,
): boolean {
    return (Object.keys(patch) as MemberPermission[]).some(
        (key) => current[key] !== patch[key],
    );
}

/**
 * THE effective-permission resolver used by every caller context:
 *   allow → true, deny → false, inherit → the group default.
 */
export function resolveMemberPermissions(
    groupDefaults: MemberPermissionsConfig,
    overrides: MemberPermissionOverrideMap,
): MemberPermissionsConfig {
    const result = { ...groupDefaults } as MemberPermissionsConfig;
    for (const key of MEMBER_PERMISSIONS) {
        const state = overrides[key];
        if (state === 'allow') result[key] = true;
        else if (state === 'deny') result[key] = false;
    }
    return result;
}

/** Short human message shared by every member-permission rejection. */
export const MEMBER_PERMISSION_FORBIDDEN_MESSAGE =
    "You don't have permission to do this in this group";

export const MEMBER_PERMISSION_FORBIDDEN: Readonly<
    Record<MemberPermission, string>
> = {
    send_messages: 'Sending text messages is disabled in this group',
    send_media: 'Sending photos and videos is disabled in this group',
    send_files: 'Sending files is disabled in this group',
    send_voice: 'Sending voice messages is disabled in this group',
    send_links: 'Sending links is disabled in this group',
    add_members: 'Adding members is disabled in this group',
    invite_via_link: 'Inviting people via link is disabled in this group',
    pin_messages: 'Pinning messages is disabled for members in this group',
    edit_own_messages: 'Editing messages is disabled for members in this group',
    delete_own_messages:
        'Deleting messages is disabled for members in this group',
};
