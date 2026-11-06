import { httpClient } from '../../core/api';
import type {
    BannedChatMemberDto,
    CreateGroupPayloadDto,
} from '../../core/api';

/**
 * Group management REST layer — the ONLY place that touches /chats* endpoints.
 * Contracts from docs/mobile-api/chats.md (verbatim semantics below).
 */

/** `POST /chats/create` — responds `{ message }`; the created chat id is NOT returned. */
export async function createGroup(
    payload: CreateGroupPayloadDto,
): Promise<void> {
    await httpClient.post('/chats/create', payload);
}

/** `POST /chats/manage/:groupId/add/:userPhone` — adds by PHONE, not user id. */
export async function addMemberByPhone(
    groupId: number,
    phone: string,
): Promise<void> {
    await httpClient.post(
        `/chats/manage/${groupId}/add/${encodeURIComponent(phone)}`,
    );
}

/** `POST /chats/manage/upload/avatar/:chatId` — multipart field `avatar` (permission: change_info_chat). */
export async function uploadGroupAvatar(
    chatId: number,
    fileUri: string,
): Promise<void> {
    const fileExtension = fileUri.split('.').pop() ?? 'png';
    const form = new FormData();
    form.append('avatar', {
        // RN FormData part shape (react-native URI variant, not web Blob).
        uri: fileUri,
        name: `avatar.${fileExtension}`,
        type: `image/${fileExtension}`,
    } as unknown as Blob);
    await httpClient.post(`/chats/manage/upload/avatar/${chatId}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
}

/** `DELETE /chats/manage/delete/avatar/:chatId` — body `{ avatar: "<path from chat.avatars>" }`. */
export async function deleteGroupAvatar(
    chatId: number,
    avatarPath: string,
): Promise<void> {
    await httpClient.delete(`/chats/manage/delete/avatar/${chatId}`, {
        data: { avatar: avatarPath },
    });
}

/** `GET /chats/manage/:chatId/bans` → `{ data: [...] }` (manager or admin with ban_user). */
export async function listBannedMembers(
    chatId: number,
): Promise<BannedChatMemberDto[]> {
    const response = await httpClient.get<{ data: BannedChatMemberDto[] }>(
        `/chats/manage/${chatId}/bans`,
    );
    return response.data.data;
}

/**
 * `POST /chats/:chatId/ban` — platform-admin only (NOT chat-manager scope).
 * Kept for completeness of the documented chat surface.
 */
export async function banChatPlatformAdmin(chatId: number): Promise<void> {
    await httpClient.post(`/chats/${chatId}/ban`);
}
