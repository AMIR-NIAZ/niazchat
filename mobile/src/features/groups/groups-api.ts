import { httpClient } from '../../core/api';
import type {
    GroupAvatarMutationResponse,
    GroupBannedPage,
    GroupBannedUser,
    GroupInfo,
    GroupInfoChanges,
    GroupInfoUpdateResponse,
    GroupMember,
    GroupMemberPage,
    GroupMemberPermissionsResponse,
    GroupMemberPermissionsUpdateResponse,
    GroupMemberPermissionsConfig,
    MemberActionResponse,
    MemberPermissionKey,
    MemberPermissionOverridesResponse,
    MemberPermissionOverridesUpdateResponse,
    MemberPermissionOverrideState,
    MemberPermissions,
    MemberPermissionsUpdate,
    AddMemberFailure,
    AddMembersResult,
    AddedGroupMember,
} from './group-model';
import {
    explicitPermissions,
    isGroupPermissionKey,
    PERMISSION_META,
    normalizeGroupMemberPermissions,
    normalizeMemberPermissionOverrides,
} from './permissions';
import { normalizeAvatarMime } from '../users/profile-service';

/**
 * REST surface of the group panel (docs/mobile-api/groups.md):
 *   GET    /chats/:chatId/group
 *   GET    /chats/:chatId/members?search=&cursor=&limit=
 *   GET    /chats/:chatId/banned?cursor=&limit=
 *   POST   /chats/manage/onban/:memberId           (legacy route, unban)
 *   POST   /chats/:chatId/members/:memberId/promote
 *   POST   /chats/:chatId/members/:memberId/demote
 *   DELETE /chats/:chatId/members/:memberId
 *   POST   /chats/:chatId/members/:memberId/ban
 *   GET    /chats/:chatId/members/:memberId/permissions
 *   PUT    /chats/:chatId/members/:memberId/permissions
 *   PATCH  /chats/:chatId/group
 *   POST   /chats/:chatId/group/avatars            (field `avatar`, adds as current)
 *   DELETE /chats/:chatId/group/avatars/:fileName  (one photo by file name)
 *   PUT    /chats/:chatId/group/avatars/:fileName/main
 *
 * Ids are normalized to numbers here, once.
 */

export const GROUP_MEMBERS_PAGE_SIZE = 30;

function number(value: unknown): number {
    return Number(value);
}

function toGroupInfo(raw: GroupInfo): GroupInfo {
    return {
        id: number(raw.id),
        title: raw.title ?? '',
        description:
            raw.description === null || raw.description === undefined
                ? null
                : String(raw.description),
        avatars: Array.isArray(raw.avatars) ? raw.avatars : [],
        createdAt: raw.createdAt,
        membersCount: number(raw.membersCount),
        myRole: raw.myRole,
        capabilities: {
            canEditInfo: raw.capabilities?.canEditInfo === true,
            canManageInviteLinks:
                raw.capabilities?.canManageInviteLinks === true,
            canManageInvites: raw.capabilities?.canManageInvites === true,
            canManageBans: raw.capabilities?.canManageBans === true,
            canRemoveMembers: raw.capabilities?.canRemoveMembers === true,
            canManageMembers: raw.capabilities?.canManageMembers === true,
            canDeleteOthersMessages:
                raw.capabilities?.canDeleteOthersMessages === true,
            canPinMessages: raw.capabilities?.canPinMessages === true,
            canManageAdmins: raw.capabilities?.canManageAdmins === true,
            canManagePermissions:
                raw.capabilities?.canManagePermissions === true,
            canRestrictMembers: raw.capabilities?.canRestrictMembers === true,
            canManageVoiceChats: raw.capabilities?.canManageVoiceChats === true,
            canManageMemberPermissions:
                raw.capabilities?.canManageMemberPermissions === true,
            canAddMembers: raw.capabilities?.canAddMembers === true,
            canInviteViaLink: raw.capabilities?.canInviteViaLink === true,
        },
        owner:
            raw.owner === null || raw.owner === undefined
                ? null
                : {
                      userId: number(raw.owner.userId),
                      name: raw.owner.name ?? '',
                      username: raw.owner.username ?? '',
                  },
    };
}

function toGroupMember(raw: GroupMember): GroupMember {
    return {
        memberId: number(raw.memberId),
        userId: number(raw.userId),
        name: raw.name ?? '',
        username: raw.username ?? '',
        avatars: Array.isArray(raw.avatars) ? raw.avatars : [],
        isOnline: raw.isOnline === true,
        lastSeen: raw.lastSeen ?? null,
        role: raw.role,
        permissions: explicitPermissions(raw.permissions),
        promotedById:
            raw.promotedById === null || raw.promotedById === undefined
                ? null
                : number(raw.promotedById),
        actions: {
            canPromote: raw.actions?.canPromote === true,
            canDemote: raw.actions?.canDemote === true,
            canRemove: raw.actions?.canRemove === true,
            canEditPermissions: raw.actions?.canEditPermissions === true,
            canBan: raw.actions?.canBan === true,
            canManageMemberPermissions:
                raw.actions?.canManageMemberPermissions === true,
        },
    };
}

export async function fetchGroupInfo(chatId: number): Promise<GroupInfo> {
    const response = await httpClient.get<GroupInfo>(`/chats/${chatId}/group`);
    return toGroupInfo(response.data);
}

/**
 * Adds up to 50 users in one batch (`POST /chats/:chatId/members`). Each user
 * is accepted or rejected independently: the response carries both arrays so
 * the app can report partial success.
 */
export async function addGroupMembers(
    chatId: number,
    userIds: number[],
): Promise<AddMembersResult> {
    const response = await httpClient.post<AddMembersResult>(
        `/chats/${chatId}/members`,
        { userIds },
    );
    return {
        added: (response.data.added ?? []).map(
            (member): AddedGroupMember => ({
                memberId: number(member.memberId),
                userId: number(member.userId),
                name: member.name ?? '',
                username: member.username ?? null,
                avatars: Array.isArray(member.avatars) ? member.avatars : [],
                role: 'member',
            }),
        ),
        failed: (response.data.failed ?? []).map(
            (failure): AddMemberFailure => ({
                userId: number(failure.userId),
                code: failure.code,
                message: failure.message ?? 'This user could not be added',
            }),
        ),
        membersCount: number(response.data.membersCount),
    };
}



/** Server cap for one members page (same as the members endpoint). */
const GROUP_MEMBER_IDS_PAGE_SIZE = 100;
const GROUP_MEMBER_IDS_MAX_PAGES = 50;

/**
 * Every active member id of the group, paged with the existing members
 * endpoint. Used by the contacts picker to disable people already in the group;
 * it never returns banned rows.
 */
export async function fetchGroupMemberIds(
    chatId: number,
): Promise<Set<number>> {
    const ids = new Set<number>();
    let cursor: string | null = null;
    for (let page = 0; page < GROUP_MEMBER_IDS_MAX_PAGES; page += 1) {
        const params: Record<string, string | number> = {
            limit: GROUP_MEMBER_IDS_PAGE_SIZE,
        };
        if (cursor !== null) params.cursor = cursor;
        const response = await httpClient.get<GroupMemberPage>(
            `/chats/${chatId}/members`,
            { params },
        );
        for (const item of response.data.items ?? []) {
            ids.add(number(item.userId));
        }
        const next = response.data.nextCursor ?? null;
        if (next === null || next === '') return ids;
        cursor = next;
    }
    return ids;
}

export async function fetchGroupMembers(
    chatId: number,
    options: { search?: string; cursor?: string | null } = {},
): Promise<GroupMemberPage> {
    const params: Record<string, string | number> = {
        limit: GROUP_MEMBERS_PAGE_SIZE,
    };
    if (options.search !== undefined && options.search !== '') {
        params.search = options.search;
    }
    if (options.cursor !== undefined && options.cursor !== null) {
        params.cursor = options.cursor;
    }
    const response = await httpClient.get<GroupMemberPage>(
        `/chats/${chatId}/members`,
        { params },
    );
    return {
        items: (response.data.items ?? []).map(toGroupMember),
        nextCursor: response.data.nextCursor ?? null,
    };
}

function toGroupBannedUser(raw: GroupBannedUser): GroupBannedUser {
    return {
        memberId: number(raw.memberId),
        userId: number(raw.userId),
        name: raw.name ?? '',
        username: raw.username ?? '',
        avatars: Array.isArray(raw.avatars) ? raw.avatars : [],
        bannedAt:
            raw.bannedAt === null || raw.bannedAt === undefined
                ? null
                : String(raw.bannedAt),
    };
}

/** One page of the group's banned users (owner, or admin with `ban_user`). */
export async function fetchBannedUsers(
    chatId: number,
    options: { cursor?: string | null } = {},
): Promise<GroupBannedPage> {
    const params: Record<string, string | number> = {
        limit: GROUP_MEMBERS_PAGE_SIZE,
    };
    if (options.cursor !== undefined && options.cursor !== null) {
        params.cursor = options.cursor;
    }
    const response = await httpClient.get<GroupBannedPage>(
        `/chats/${chatId}/banned`,
        { params },
    );
    return {
        items: (response.data.items ?? []).map(toGroupBannedUser),
        nextCursor: response.data.nextCursor ?? null,
    };
}

/**
 * `POST /chats/manage/onban/:memberId` — restores the `user` role. The same
 * permission rule as the banned list (owner, or admin with `ban_user`/`all`)
 * is enforced server-side and the server emits `group:changed` so other open
 * screens refresh.
 */
export async function unbanMember(memberId: number): Promise<void> {
    await httpClient.post(`/chats/manage/onban/${memberId}`);
}

function toMemberActionResponse(
    raw: MemberActionResponse,
): MemberActionResponse {
    return {
        memberId: number(raw.memberId),
        role: raw.role ?? null,
        changed: raw.changed === true,
    };
}

export async function promoteMember(
    chatId: number,
    memberId: number,
    permissions: MemberPermissionKey[],
): Promise<MemberActionResponse> {
    const response = await httpClient.post<MemberActionResponse>(
        `/chats/${chatId}/members/${memberId}/promote`,
        { permissions },
    );
    return toMemberActionResponse(response.data);
}

export async function demoteMember(
    chatId: number,
    memberId: number,
): Promise<MemberActionResponse> {
    const response = await httpClient.post<MemberActionResponse>(
        `/chats/${chatId}/members/${memberId}/demote`,
    );
    return toMemberActionResponse(response.data);
}

export async function removeMember(
    chatId: number,
    memberId: number,
): Promise<MemberActionResponse> {
    const response = await httpClient.delete<MemberActionResponse>(
        `/chats/${chatId}/members/${memberId}`,
    );
    return toMemberActionResponse(response.data);
}

/**
 * Ban (owner, or admin with `ban_user`/`all`): the member keeps a membership
 * row with the `ban` role, so they cannot read/send, rejoin or be re-added
 * until unbanned. The response has `role: null` like a removal.
 */
export async function banMember(
    chatId: number,
    memberId: number,
): Promise<MemberActionResponse> {
    const response = await httpClient.post<MemberActionResponse>(
        `/chats/${chatId}/members/${memberId}/ban`,
    );
    return toMemberActionResponse(response.data);
}

function permissionKeys(value: unknown): MemberPermissionKey[] {
    return explicitPermissions(Array.isArray(value) ? value : []);
}

function toMemberPermissions(raw: MemberPermissions): MemberPermissions {
    return {
        memberId: number(raw.memberId),
        userId: number(raw.userId),
        role: 'admin',
        available: Array.isArray(raw.available)
            ? raw.available
                  .filter((option) => isGroupPermissionKey(option.key))
                  .map((option) => ({
                      key: option.key,
                      label: option.label ?? option.key,
                      active: option.active !== false,
                      description:
                          option.description ??
                          PERMISSION_META[option.key].description,
                      implies: Array.isArray(option.implies)
                          ? option.implies.filter(isGroupPermissionKey)
                          : [...PERMISSION_META[option.key].implies],
                  }))
            : [],
        granted: permissionKeys(raw.granted),
        hasAll: raw.hasAll === true,
        grantable: permissionKeys(raw.grantable),
        promotedById:
            raw.promotedById === null || raw.promotedById === undefined
                ? null
                : number(raw.promotedById),
    };
}

export async function fetchMemberPermissions(
    chatId: number,
    memberId: number,
): Promise<MemberPermissions> {
    const response = await httpClient.get<MemberPermissions>(
        `/chats/${chatId}/members/${memberId}/permissions`,
    );
    return toMemberPermissions(response.data);
}

function toGroupInfoUpdate(
    raw: GroupInfoUpdateResponse,
): GroupInfoUpdateResponse {
    return {
        id: number(raw.id),
        title: raw.title ?? '',
        description:
            raw.description === null || raw.description === undefined
                ? null
                : String(raw.description),
        avatars: Array.isArray(raw.avatars) ? raw.avatars : [],
        changed: raw.changed === true,
    };
}

export async function updateGroupInfo(
    chatId: number,
    changes: GroupInfoChanges,
): Promise<GroupInfoUpdateResponse> {
    const response = await httpClient.patch<GroupInfoUpdateResponse>(
        `/chats/${chatId}/group`,
        changes,
    );
    return toGroupInfoUpdate(response.data);
}

/** One picked image, exactly as `expo-image-picker` reports it. */
export interface GroupAvatarUploadAsset {
    uri: string;
    mimeType: string | null;
    fileName: string | null;
}

function extensionForMime(mimeType: string): string {
    switch (mimeType) {
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        default:
            return 'jpg';
    }
}

/**
 * Uploads one group photo (multipart field `avatar`). No manual
 * `Content-Type`: React Native writes the boundary itself.
 */
export async function uploadGroupAvatar(
    chatId: number,
    asset: GroupAvatarUploadAsset,
): Promise<GroupAvatarMutationResponse> {
    const mimeType = normalizeAvatarMime(asset.mimeType, asset.fileName);
    if (mimeType === null) {
        throw new Error('Pick a JPEG, PNG or WebP image.');
    }
    const form = new FormData();
    form.append('avatar', {
        uri: asset.uri,
        name: asset.fileName ?? `group.${extensionForMime(mimeType)}`,
        type: mimeType,
    } as unknown as Blob);

    const response = await httpClient.post<GroupAvatarMutationResponse>(
        `/chats/${chatId}/group/avatars`,
        form,
    );
    return toAvatarMutation(response.data);
}

/** Removes ONE photo by its stored file name (`uploads/avatars/x.png` → x.png). */
export async function deleteGroupAvatar(
    chatId: number,
    fileName: string,
): Promise<GroupAvatarMutationResponse> {
    const response = await httpClient.delete<GroupAvatarMutationResponse>(
        `/chats/${chatId}/group/avatars/${encodeURIComponent(fileName)}`,
    );
    return toAvatarMutation(response.data);
}

/** Moves one photo to index 0 (current), keeping the others' order. */
export async function setMainGroupAvatar(
    chatId: number,
    fileName: string,
): Promise<GroupAvatarMutationResponse> {
    const response = await httpClient.put<GroupAvatarMutationResponse>(
        `/chats/${chatId}/group/avatars/${encodeURIComponent(fileName)}/main`,
    );
    return toAvatarMutation(response.data);
}

function toAvatarMutation(
    raw: GroupAvatarMutationResponse,
): GroupAvatarMutationResponse {
    return {
        id: number(raw.id),
        avatars: Array.isArray(raw.avatars) ? raw.avatars : [],
        changed: raw.changed === true,
    };
}

function toGroupMemberPermissions(
    raw: GroupMemberPermissionsResponse,
): GroupMemberPermissionsResponse {
    return {
        chatId: number(raw.chatId),
        permissions: normalizeGroupMemberPermissions(
            raw.permissions,
        ) as GroupMemberPermissionsConfig,
        canEdit: raw.canEdit === true,
    };
}

/** The group's member policy (readable by every non-banned member). */
export async function fetchGroupMemberPermissions(
    chatId: number,
): Promise<GroupMemberPermissionsResponse> {
    const response = await httpClient.get<GroupMemberPermissionsResponse>(
        `/chats/${chatId}/member-permissions`,
    );
    return toGroupMemberPermissions(response.data);
}

/** Partial update; only the changed switches are sent. */
export async function updateGroupMemberPermissions(
    chatId: number,
    patch: Partial<GroupMemberPermissionsConfig>,
): Promise<GroupMemberPermissionsUpdateResponse> {
    const response =
        await httpClient.patch<GroupMemberPermissionsUpdateResponse>(
            `/chats/${chatId}/member-permissions`,
            patch,
        );
    return {
        ...toGroupMemberPermissions(response.data),
        changed: response.data.changed === true,
    };
}

function toMemberPermissionOverrides(
    raw: MemberPermissionOverridesResponse,
): MemberPermissionOverridesResponse {
    return {
        chatId: number(raw.chatId),
        memberId: number(raw.memberId),
        userId: number(raw.userId),
        role: 'member',
        groupPermissions: normalizeGroupMemberPermissions(
            raw.groupPermissions,
        ) as GroupMemberPermissionsConfig,
        overrides: normalizeMemberPermissionOverrides(raw.overrides),
        effective: normalizeGroupMemberPermissions(
            raw.effective,
        ) as GroupMemberPermissionsConfig,
        canEdit: raw.canEdit === true,
    };
}

/** One member's individual overrides + effective permissions. */
export async function fetchMemberPermissionOverrides(
    chatId: number,
    memberId: number,
): Promise<MemberPermissionOverridesResponse> {
    const response = await httpClient.get<MemberPermissionOverridesResponse>(
        `/chats/${chatId}/members/${memberId}/permission-overrides`,
    );
    return toMemberPermissionOverrides(response.data);
}

/** Partial tri-state patch; `inherit` resets that single key. */
export async function updateMemberPermissionOverrides(
    chatId: number,
    memberId: number,
    patch: Partial<Record<MemberPermissionKey, MemberPermissionOverrideState>>,
): Promise<MemberPermissionOverridesUpdateResponse> {
    const response =
        await httpClient.patch<MemberPermissionOverridesUpdateResponse>(
            `/chats/${chatId}/members/${memberId}/permission-overrides`,
            patch,
        );
    return {
        ...toMemberPermissionOverrides(response.data),
        changed: response.data.changed === true,
    };
}

/** Resets every override of one member to `inherit`. */
export async function resetMemberPermissionOverrides(
    chatId: number,
    memberId: number,
): Promise<MemberPermissionOverridesUpdateResponse> {
    const response =
        await httpClient.delete<MemberPermissionOverridesUpdateResponse>(
            `/chats/${chatId}/members/${memberId}/permission-overrides`,
        );
    return {
        ...toMemberPermissionOverrides(response.data),
        changed: response.data.changed === true,
    };
}

export async function updateMemberPermissions(
    chatId: number,
    memberId: number,
    permissions: MemberPermissionKey[],
): Promise<MemberPermissionsUpdate> {
    const response = await httpClient.put<MemberPermissionsUpdate>(
        `/chats/${chatId}/members/${memberId}/permissions`,
        { permissions },
    );
    return {
        memberId: number(response.data.memberId),
        granted: permissionKeys(response.data.granted),
        hasAll: response.data.hasAll === true,
        changed: response.data.changed === true,
    };
}
