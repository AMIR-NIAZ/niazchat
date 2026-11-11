/**
 * Group panel domain model (wire shapes + pure UI helpers).
 *
 * The server is the only authority on `actions`; the sheet renders exactly the
 * flags it receives and never derives permissions locally.
 */

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMemberActions {
    canPromote: boolean;
    canDemote: boolean;
    canRemove: boolean;
    /** Owner viewing an admin: open the permission editor. */
    canEditPermissions: boolean;
}

export type GroupMemberAction = 'permissions' | 'promote' | 'demote' | 'remove';

export type MemberPermissionKey =
    | 'ban_user'
    | 'delete_message'
    | 'change_info_chat';

export interface MemberPermissionOption {
    key: MemberPermissionKey;
    label: string;
}

export interface MemberPermissions {
    memberId: number;
    userId: number;
    role: 'admin';
    available: MemberPermissionOption[];
    granted: MemberPermissionKey[];
    hasAll: boolean;
}

export interface MemberPermissionsUpdate {
    memberId: number;
    granted: MemberPermissionKey[];
    changed: boolean;
}

export interface GroupOwner {
    userId: number;
    name: string;
    username: string;
}

export interface GroupCapabilities {
    canEditInfo: boolean;
    canManageInviteLinks: boolean;
}

export interface GroupInfo {
    id: number;
    title: string;
    /** Nullable group description; null clears it. */
    description: string | null;
    /** All group photos, current first (at most one today). */
    avatars: string[];
    createdAt: string;
    membersCount: number;
    myRole: GroupRole;
    owner: GroupOwner | null;
    /** Server-computed for the caller (never derived client-side). */
    capabilities: GroupCapabilities;
}

export interface GroupMember {
    memberId: number;
    userId: number;
    name: string;
    username: string;
    /** Current photo only. */
    avatars: string[];
    isOnline: boolean;
    lastSeen: string | null;
    role: GroupRole;
    actions: GroupMemberActions;
}

export interface GroupMemberPage {
    items: GroupMember[];
    nextCursor: string | null;
}

export interface MemberActionResponse {
    memberId: number;
    /** null after removal. */
    role: GroupRole | null;
    changed: boolean;
}

/** Mirrors the backend limit for group photos. */
export const MAX_GROUP_AVATARS = 10;

/**
 * The group info screen shows a gallery under the header only when there is
 * more than the header photo; a single photo adds nothing to the screen.
 */
export function groupHasPhotoGallery(photoCount: number): boolean {
    return photoCount > 1;
}

/** Add tile vs `10/10` limit hint in the photo manager. */
export function groupPhotoTileVisibility(photoCount: number): {
    showAdd: boolean;
    showLimit: boolean;
} {
    const atLimit = photoCount >= MAX_GROUP_AVATARS;
    return { showAdd: !atLimit, showLimit: atLimit };
}

/** What the caller may do with the group's photos (server remains authority). */
export function groupPhotoActions(canEditInfo: boolean): {
    canAdd: boolean;
    canSetMain: boolean;
    canDelete: boolean;
    viewerReadOnly: boolean;
} {
    return {
        canAdd: canEditInfo,
        canSetMain: canEditInfo,
        canDelete: canEditInfo,
        viewerReadOnly: !canEditInfo,
    };
}

/** Caption under the photo manager; null while under the limit. */
export function groupPhotoLimitHint(photoCount: number): string | null {
    return photoCount >= MAX_GROUP_AVATARS
        ? `${MAX_GROUP_AVATARS}/${MAX_GROUP_AVATARS} photos — delete one to add another`
        : null;
}

export const GROUP_INFO_STALE_TIME_MS = 30_000;
export const GROUP_MEMBERS_STALE_TIME_MS = 30_000;

export function groupInfoQueryKey(chatId: number): readonly [string, number] {
    return ['group', chatId] as const;
}

export function groupMembersQueryKey(
    chatId: number,
    search: string,
): readonly [string, number, string, string] {
    return ['group', chatId, 'members', search] as const;
}

/** Prefix shared by every members page of one group. */
export function groupMembersPrefix(
    chatId: number,
): readonly [string, number, string] {
    return ['group', chatId, 'members'] as const;
}

export function memberPermissionsQueryKey(
    chatId: number,
    memberId: number,
): readonly [string, number, string, number] {
    return ['group', chatId, 'permissions', memberId] as const;
}

export function memberPermissionsPrefix(
    chatId: number,
): readonly [string, number, string] {
    return ['group', chatId, 'permissions'] as const;
}

const PERMISSION_KEYS: readonly MemberPermissionKey[] = [
    'ban_user',
    'delete_message',
    'change_info_chat',
];

export function isMemberPermissionKey(
    value: unknown,
): value is MemberPermissionKey {
    return (
        typeof value === 'string' &&
        (PERMISSION_KEYS as readonly string[]).includes(value)
    );
}

export function permissionDescription(key: MemberPermissionKey): string {
    switch (key) {
        case 'ban_user':
            return 'can remove regular members from the group';
        case 'delete_message':
            return "can delete other members' messages";
        case 'change_info_chat':
            return "can change the group's title and photo";
    }
}

export function permissionSetEquals(
    left: readonly MemberPermissionKey[],
    right: readonly MemberPermissionKey[],
): boolean {
    const a = new Set(left);
    const b = new Set(right);
    if (a.size !== b.size) return false;
    for (const value of a) {
        if (!b.has(value)) return false;
    }
    return true;
}

export function togglePermissionSelection(
    current: readonly MemberPermissionKey[],
    key: MemberPermissionKey,
): MemberPermissionKey[] {
    return current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key];
}

/** Only permitted actions, in menu order. */
export function visibleMemberActions(
    actions: GroupMemberActions,
): GroupMemberAction[] {
    const visible: GroupMemberAction[] = [];
    if (actions.canEditPermissions) visible.push('permissions');
    if (actions.canPromote) visible.push('promote');
    if (actions.canDemote) visible.push('demote');
    if (actions.canRemove) visible.push('remove');
    return visible;
}

export function hasMemberActions(actions: GroupMemberActions): boolean {
    return visibleMemberActions(actions).length > 0;
}

export function memberActionLabel(action: GroupMemberAction): string {
    switch (action) {
        case 'permissions':
            return 'Edit permissions';
        case 'promote':
            return 'Make admin';
        case 'demote':
            return 'Remove admin';
        case 'remove':
            return 'Remove from group';
    }
}

/** Small badge next to a member name; members get no badge. */
export function roleBadgeLabel(role: GroupRole): 'Owner' | 'Admin' | null {
    if (role === 'owner') return 'Owner';
    if (role === 'admin') return 'Admin';
    return null;
}

export interface MembersPagesLike<T> {
    pages: T[];
    pageParams: unknown[];
}

export interface MembersPageLike {
    items: GroupMember[];
    nextCursor: string | null;
}

/**
 * Updates one member in a cached infinite page set (role badge immediate).
 * A null role removes the row (removal). Other rows keep their identity.
 */
export function patchMembersPages<T extends MembersPageLike>(
    pages: T[],
    memberId: number,
    role: GroupRole | null,
): T[] {
    return pages.map((page) => {
        const items = page.items
            .filter((item) => {
                if (item.memberId !== memberId) return true;
                return role !== null;
            })
            .map((item) =>
                item.memberId === memberId && role !== null
                    ? { ...item, role }
                    : item,
            );
        return { ...page, items };
    });
}

/** True when any cached page still contains the row. */
export function pagesContainMember<T extends MembersPageLike>(
    pages: T[],
    memberId: number,
): boolean {
    return pages.some((page) =>
        page.items.some((item) => item.memberId === memberId),
    );
}

// ── group settings (gear + edit group info) ────────────────────────────────

export const GROUP_TITLE_MAX_LENGTH = 64;
export const GROUP_DESCRIPTION_MAX_LENGTH = 255;

/** The gear is only offered to the owner and admins (never to members). */
export function canOpenGroupSettings(
    role: GroupRole | null | undefined,
): boolean {
    return role === 'owner' || role === 'admin';
}

export type GroupSettingsCapability = keyof GroupCapabilities;

export interface GroupSettingsFeature {
    key: 'group_info' | 'invite_links';
    title: string;
    subtitle: string;
    icon: string;
    requires: GroupSettingsCapability;
    route: (chatId: number) => string;
}

/**
 * Every group setting the app knows about. A row renders only when the caller
 * holds its server-computed capability.
 */
export const GROUP_SETTINGS_FEATURES: readonly GroupSettingsFeature[] = [
    {
        key: 'group_info',
        title: 'Group info',
        subtitle: 'Name, photo and description',
        icon: '⚙',
        requires: 'canEditInfo',
        route: (chatId: number): string => `/group-settings/${chatId}/info`,
    },
    {
        key: 'invite_links',
        title: 'Invite links',
        subtitle: 'Create and manage links to join this group',
        icon: '🔗',
        requires: 'canManageInviteLinks',
        route: (chatId: number): string =>
            `/group-settings/${chatId}/invite-links`,
    },
];

export function visibleGroupSettingsFeatures(
    capabilities: GroupCapabilities | null | undefined,
): GroupSettingsFeature[] {
    if (capabilities === null || capabilities === undefined) {
        return [];
    }
    return GROUP_SETTINGS_FEATURES.filter(
        (feature) => capabilities[feature.requires] === true,
    );
}

export interface GroupInfoUpdateResponse {
    id: number;
    title: string;
    description: string | null;
    avatars: string[];
    changed: boolean;
}

export interface GroupAvatarMutationResponse {
    id: number;
    avatars: string[];
    changed: boolean;
}

export interface GroupInfoDraft {
    title: string;
    description: string;
}

export interface GroupInfoChanges {
    title?: string;
    description?: string | null;
}

/**
 * Local validation mirrors the server: a trimmed title of 1..64 characters
 * and a description of at most 255 characters. Returns the error or null.
 */
export function groupTitleError(raw: string): string | null {
    const title = raw.trim();
    if (title === '') return 'A group name is required.';
    if (title.length > GROUP_TITLE_MAX_LENGTH) {
        return `Up to ${GROUP_TITLE_MAX_LENGTH} characters.`;
    }
    return null;
}

export function groupDescriptionError(raw: string): string | null {
    return raw.trim().length > GROUP_DESCRIPTION_MAX_LENGTH
        ? `Up to ${GROUP_DESCRIPTION_MAX_LENGTH} characters.`
        : null;
}

/** Only fields whose trimmed value differs from the saved group info. */
export function groupInfoChanges(
    draft: GroupInfoDraft,
    info: Pick<GroupInfo, 'title' | 'description'>,
): GroupInfoChanges | null {
    const changes: GroupInfoChanges = {};
    const title = draft.title.trim();
    if (title !== (info.title ?? '')) {
        changes.title = title;
    }
    const description = draft.description.trim();
    const savedDescription = info.description ?? '';
    if (description !== savedDescription) {
        changes.description = description === '' ? null : description;
    }
    return changes.title === undefined && changes.description === undefined
        ? null
        : changes;
}

export function isGroupInfoDirty(
    draft: GroupInfoDraft,
    info: Pick<GroupInfo, 'title' | 'description'>,
): boolean {
    return groupInfoChanges(draft, info) !== null;
}

/** Saves are allowed only when dirty, valid and not already saving. */
export function canSaveGroupInfo(
    draft: GroupInfoDraft,
    info: Pick<GroupInfo, 'title' | 'description'>,
    saving: boolean,
): boolean {
    return (
        !saving &&
        groupTitleError(draft.title) === null &&
        groupDescriptionError(draft.description) === null &&
        isGroupInfoDirty(draft, info)
    );
}
