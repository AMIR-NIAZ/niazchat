import { httpClient } from '../../core/api';
import type {
    GroupAvatarMutationResponse,
    GroupInfo,
    GroupInfoChanges,
    GroupInfoUpdateResponse,
    GroupMember,
    GroupMemberPage,
    MemberActionResponse,
    MemberPermissionKey,
    MemberPermissions,
    MemberPermissionsUpdate,
} from './group-model';
import { isMemberPermissionKey } from './group-model';
import { normalizeAvatarMime } from '../users/profile-service';

/**
 * REST surface of the group panel (docs/mobile-api/groups.md):
 *   GET    /chats/:chatId/group
 *   GET    /chats/:chatId/members?search=&cursor=&limit=
 *   POST   /chats/:chatId/members/:memberId/promote
 *   POST   /chats/:chatId/members/:memberId/demote
 *   DELETE /chats/:chatId/members/:memberId
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
        actions: {
            canPromote: raw.actions?.canPromote === true,
            canDemote: raw.actions?.canDemote === true,
            canRemove: raw.actions?.canRemove === true,
            canEditPermissions: raw.actions?.canEditPermissions === true,
        },
    };
}

export async function fetchGroupInfo(chatId: number): Promise<GroupInfo> {
    const response = await httpClient.get<GroupInfo>(`/chats/${chatId}/group`);
    return toGroupInfo(response.data);
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
): Promise<MemberActionResponse> {
    const response = await httpClient.post<MemberActionResponse>(
        `/chats/${chatId}/members/${memberId}/promote`,
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

function permissionKeys(value: unknown): MemberPermissionKey[] {
    return Array.isArray(value) ? value.filter(isMemberPermissionKey) : [];
}

function toMemberPermissions(raw: MemberPermissions): MemberPermissions {
    return {
        memberId: number(raw.memberId),
        userId: number(raw.userId),
        role: 'admin',
        available: Array.isArray(raw.available)
            ? raw.available
                  .filter((option) => isMemberPermissionKey(option.key))
                  .map((option) => ({
                      key: option.key,
                      label: option.label ?? option.key,
                  }))
            : [],
        granted: permissionKeys(raw.granted),
        hasAll: raw.hasAll === true,
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
        changed: response.data.changed === true,
    };
}
