/**
 * Group panel domain model (wire shapes + pure UI helpers).
 *
 * The server is the only authority on `actions`; the sheet renders exactly the
 * flags it receives and never derives permissions locally.
 */

import {
    Link,
    LucideIcon,
    PencilSparkles,
    Shield,
    ShieldCheck,
    UserPlus,
    UserX,
} from 'lucide-react-native';
import {
    GROUP_PERMISSIONS,
    PERMISSION_META,
    hasPermission,
    permissionSetEquals,
    togglePermissionSelection,
} from './permissions';
import type {
    GroupMemberPermissionKey,
    GroupPermissionKey,
    MemberPermissionOverrideMap,
} from './permissions';

export type {
    MemberPermissionOverrideMap,
    MemberPermissionOverrideState,
} from './permissions';

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMemberActions {
    canPromote: boolean;
    canDemote: boolean;
    canRemove: boolean;
    /** Owner viewing an admin: open the permission editor. */
    canEditPermissions: boolean;
    /** Owner (members/admins) or admin with `ban_user`/`all` (members). */
    canBan: boolean;
    /** Owner, or admin with `manage_permissions`, viewing a regular member. */
    canManageMemberPermissions?: boolean;
}

export type GroupMemberAction =
    | 'permissions'
    | 'member-permissions'
    | 'promote'
    | 'demote'
    | 'remove'
    | 'ban';

export type MemberPermissionKey = GroupPermissionKey;

export interface MemberPermissionOption {
    key: MemberPermissionKey;
    label: string;
    active?: boolean;
    description?: string;
    implies?: MemberPermissionKey[];
}

export interface MemberPermissions {
    memberId: number;
    userId: number;
    role: 'admin';
    available: MemberPermissionOption[];
    granted: MemberPermissionKey[];
    hasAll: boolean;
    /** Keys the caller may itself grant (owner: all 12). */
    grantable: MemberPermissionKey[];
    promotedById: number | null;
}

export interface MemberPermissionsUpdate {
    memberId: number;
    granted: MemberPermissionKey[];
    hasAll: boolean;
    changed: boolean;
}

export interface GroupOwner {
    userId: number;
    name: string;
    username: string;
}

export interface GroupCapabilities {
    canEditInfo: boolean;
    /** Alias kept for older payloads; mirrors `canManageInvites`. */
    canManageInviteLinks: boolean;
    canManageInvites?: boolean;
    /** `ban_users`: banned list + unban + ban. */
    canManageBans?: boolean;
    canRemoveMembers?: boolean;
    canManageMembers?: boolean;
    canDeleteOthersMessages?: boolean;
    canPinMessages?: boolean;
    canManageAdmins?: boolean;
    canManagePermissions?: boolean;
    canRestrictMembers?: boolean;
    canManageVoiceChats?: boolean;
    /** Owner, or admin with `manage_permissions`: edit member permissions. */
    canManageMemberPermissions?: boolean;
    /** Owner/admin with `manage_members`, or a member with `add_members`. */
    canAddMembers?: boolean;
    /** Owner/admin with `manage_invites`, or a member with `invite_via_link`. */
    canInviteViaLink?: boolean;
}

// ── group-wide MEMBER permission policy ───────────────────────────────────

export type GroupMemberPermissionsConfig = Record<
    GroupMemberPermissionKey,
    boolean
>;

export interface GroupMemberPermissionsResponse {
    chatId: number;
    permissions: GroupMemberPermissionsConfig;
    /** The caller may edit the policy (owner / admin with `manage_permissions`). */
    canEdit: boolean;
}

export interface GroupMemberPermissionsUpdateResponse extends GroupMemberPermissionsResponse {
    changed: boolean;
}

// ── individual member overrides ───────────────────────────────────────────

export interface MemberPermissionOverridesResponse {
    chatId: number;
    memberId: number;
    userId: number;
    role: 'member';
    /** Group defaults the overrides inherit from. */
    groupPermissions: GroupMemberPermissionsConfig;
    /** Complete tri-state map; `inherit` fills unset keys. */
    overrides: MemberPermissionOverrideMap;
    /** `overrides ?? groupDefaults` resolved by the server. */
    effective: GroupMemberPermissionsConfig;
    canEdit: boolean;
}

export interface MemberPermissionOverridesUpdateResponse extends MemberPermissionOverridesResponse {
    changed: boolean;
}

export function canManageBans(capabilities: GroupCapabilities): boolean {
    return capabilities.canManageBans === true;
}

export function canManageInvites(capabilities: GroupCapabilities): boolean {
    return (
        capabilities.canManageInvites === true ||
        capabilities.canManageInviteLinks === true
    );
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
    /** Normalized grant set of an admin (empty for members/owner). */
    permissions: MemberPermissionKey[];
    /** Who promoted this admin (`null` for legacy/owner/member rows). */
    promotedById: number | null;
    actions: GroupMemberActions;
}

export interface GroupMemberPage {
    items: GroupMember[];
    nextCursor: string | null;
}

/** One banned user (`role_chat.name = 'ban'` membership row). */
export interface GroupBannedUser {
    memberId: number;
    userId: number;
    name: string;
    username: string;
    /** Current photo only, same wire format as members. */
    avatars: string[];
    /** ISO timestamp of the ban, when the server knows it. */
    bannedAt: string | null;
}

export interface GroupBannedPage {
    items: GroupBannedUser[];
    nextCursor: string | null;
}

// ── add members ───────────────────────────────────────────────────────────

export interface AddedGroupMember {
    memberId: number;
    userId: number;
    name: string;
    username: string | null;
    avatars: string[];
    role: 'member';
}

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

export interface AddMembersResult {
    added: AddedGroupMember[];
    failed: AddMemberFailure[];
    membersCount: number;
}

export function groupMemberIdsQueryKey(
    chatId: number,
): readonly [string, number, string] {
    return ['group', chatId, 'member-ids'] as const;
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

export const GROUP_BANNED_STALE_TIME_MS = 15_000;

export function groupBannedQueryKey(
    chatId: number,
): readonly [string, number, string] {
    return ['group', chatId, 'banned'] as const;
}

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

export function memberPermissionOverridesQueryKey(
    chatId: number,
    memberId: number,
): readonly [string, number, string, number] {
    return ['group', chatId, 'permission-overrides', memberId] as const;
}

export function memberPermissionOverridesPrefix(
    chatId: number,
): readonly [string, number, string] {
    return ['group', chatId, 'permission-overrides'] as const;
}

/** The group-wide member policy (separate from per-admin grants). */
export function groupMemberPermissionsQueryKey(
    chatId: number,
): readonly [string, number, string] {
    return ['group', chatId, 'member-permissions'] as const;
}

const PERMISSION_KEYS: readonly MemberPermissionKey[] = GROUP_PERMISSIONS;

export function isMemberPermissionKey(
    value: unknown,
): value is MemberPermissionKey {
    return (
        typeof value === 'string' &&
        (PERMISSION_KEYS as readonly string[]).includes(value)
    );
}

export function permissionDescription(key: MemberPermissionKey): string {
    return PERMISSION_META[key].description;
}

export { permissionSetEquals, togglePermissionSelection };
export { permissionSummary } from './permissions';

// ── pure member action helpers (mirror the backend contract) ──────────────

export interface MemberActionCaller {
    role: GroupRole;
    permissions: readonly MemberPermissionKey[];
    userId: number | null;
}

export interface MemberActionTarget {
    role: GroupRole;
    promotedById?: number | null;
}

function callerHas(
    caller: MemberActionCaller,
    key: GroupPermissionKey,
): boolean {
    return hasPermission(caller.role, caller.permissions, key);
}

function promotedByCaller(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): boolean {
    return (
        caller.userId !== null &&
        target.promotedById !== null &&
        target.promotedById !== undefined &&
        Number(target.promotedById) === Number(caller.userId)
    );
}

export function canPromote(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): boolean {
    if (target.role !== 'member') return false;
    return caller.role === 'owner' || callerHas(caller, 'manage_admins');
}

export function canDemote(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): boolean {
    if (target.role !== 'admin') return false;
    if (caller.role === 'owner') return true;
    return (
        callerHas(caller, 'manage_admins') && promotedByCaller(caller, target)
    );
}

export function canEditPermissions(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): boolean {
    if (target.role !== 'admin') return false;
    if (caller.role === 'owner') return true;
    return (
        callerHas(caller, 'manage_permissions') &&
        promotedByCaller(caller, target)
    );
}

export function canRemove(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): boolean {
    if (target.role === 'owner') return false;
    if (caller.role === 'owner') return true;
    return target.role === 'member' && callerHas(caller, 'remove_members');
}

export function canBan(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): boolean {
    if (target.role === 'owner') return false;
    if (caller.role === 'owner') return true;
    return target.role === 'member' && callerHas(caller, 'ban_users');
}

/** Individual overrides exist for regular members only (mirrors server). */
export function canManageMemberPermissionsFor(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): boolean {
    if (target.role !== 'member') return false;
    if (caller.role === 'owner') return true;
    return caller.role === 'admin' && callerHas(caller, 'manage_permissions');
}

export function memberActionsFor(
    caller: MemberActionCaller,
    target: MemberActionTarget,
): GroupMemberActions {
    return {
        canPromote: canPromote(caller, target),
        canDemote: canDemote(caller, target),
        canRemove: canRemove(caller, target),
        canEditPermissions: canEditPermissions(caller, target),
        canBan: canBan(caller, target),
        canManageMemberPermissions: canManageMemberPermissionsFor(
            caller,
            target,
        ),
    };
}

/** Only permitted actions, in menu order. */
export function visibleMemberActions(
    actions: GroupMemberActions,
): GroupMemberAction[] {
    const visible: GroupMemberAction[] = [];
    if (actions.canEditPermissions) visible.push('permissions');
    if (actions.canManageMemberPermissions === true) {
        visible.push('member-permissions');
    }
    if (actions.canPromote) visible.push('promote');
    if (actions.canDemote) visible.push('demote');
    if (actions.canRemove) visible.push('remove');
    if (actions.canBan) visible.push('ban');
    return visible;
}

export function hasMemberActions(actions: GroupMemberActions): boolean {
    return visibleMemberActions(actions).length > 0;
}

export function memberActionLabel(action: GroupMemberAction): string {
    switch (action) {
        case 'permissions':
            return 'Edit permissions';
        case 'member-permissions':
            return 'Manage permissions';
        case 'promote':
            return 'Make admin';
        case 'demote':
            return 'Remove admin';
        case 'remove':
            return 'Remove from group';
        case 'ban':
            return 'Ban';
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

export interface GroupSettingsFeature {
    key:
        | 'group_info'
        | 'invite_links'
        | 'banned-users'
        | 'members'
        | 'admins'
        | 'member_permissions'
        | 'add_members';
    title: string;
    subtitle: string;
    icon: LucideIcon;
    /** Server-computed capability that gates this row. */
    visible: (capabilities: GroupCapabilities) => boolean;
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
        icon: PencilSparkles,
        visible: (capabilities): boolean => capabilities.canEditInfo === true,
        route: (chatId: number): string => `/group-settings/${chatId}/info`,
    },
    {
        key: 'add_members',
        title: 'Add members',
        subtitle: 'Add people from your contacts',
        icon: UserPlus,
        visible: (capabilities): boolean => capabilities.canAddMembers === true,
        route: (chatId: number): string =>
            `/group-settings/${chatId}/add-members`,
    },
    {
        key: 'invite_links',
        title: 'Invite links',
        subtitle: 'Create and manage links to join this group',
        icon: Link,
        visible: canManageInvites,
        route: (chatId: number): string =>
            `/group-settings/${chatId}/invite-links`,
    },
    {
        key: 'banned-users',
        title: 'Banned users',
        subtitle: 'See who is banned and unban them',
        icon: UserX,
        visible: canManageBans,
        route: (chatId: number): string => `/group-settings/${chatId}/banned`,
    },
    {
        key: 'members',
        title: 'Members',
        subtitle: 'Add people and manage the member list',
        icon: UserX,
        visible: (capabilities): boolean =>
            capabilities.canManageMembers === true,
        route: (chatId: number): string => `/group/${chatId}`,
    },
    {
        key: 'admins',
        title: 'Admins & permissions',
        subtitle: 'Promote admins and edit what they can do',
        icon: Shield,
        visible: (capabilities): boolean =>
            capabilities.canManageAdmins === true ||
            capabilities.canManagePermissions === true,
        route: (chatId: number): string => `/group/${chatId}`,
    },
    {
        key: 'member_permissions',
        title: 'Member permissions',
        subtitle: 'Choose what regular members can do in this group',
        icon: ShieldCheck,
        visible: (capabilities): boolean =>
            capabilities.canManageMemberPermissions === true,
        route: (chatId: number): string =>
            `/group-settings/${chatId}/member-permissions`,
    },
];

export function visibleGroupSettingsFeatures(
    capabilities: GroupCapabilities | null | undefined,
): GroupSettingsFeature[] {
    if (capabilities === null || capabilities === undefined) {
        return [];
    }
    return GROUP_SETTINGS_FEATURES.filter((feature) =>
        feature.visible(capabilities),
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
