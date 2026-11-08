import { httpClient } from '../../core/api';
import type {
    BannedChatMemberDto,
    CreateGroupPayloadDto,
} from '../../core/api';
import type { ChatRole } from '../../core/api/dto/chat.dto';

/**
 * Group management REST layer — the ONLY place that touches /chats* endpoints.
 * Contracts from docs/mobile-api/chats.md (verbatim semantics below).
 */

/**
 * `GET /chats/manage/:chatId/members` (page size 1) → the per-caller extras
 * include `myRole`; only the caller's own role is read here. `manager` is the
 * group owner, `admin` is an ordinary chat admin.
 */
export async function getMyChatRole(chatId: number): Promise<ChatRole | null> {
    const response = await httpClient.get<{ myRole?: ChatRole | null }>(
        `/chats/manage/${chatId}/members`,
        { params: { limit: 1 } },
    );
    return response.data.myRole ?? null;
}

/** One active (non-banned) group member from the members endpoint. */
export interface ChatMemberRow {
    memberId: number;
    userId: number;
    name: string;
    username: string | null;
    role: ChatRole | null;
    isBanned: boolean;
}

/**
 * `GET /chats/manage/:chatId/members` — one page (server caps `limit` at 100),
 * banned rows excluded. Backend shape: `serializeMember` + per-caller extras.
 */
export async function listChatMembers(
    chatId: number,
): Promise<ChatMemberRow[]> {
    const response = await httpClient.get<{ data: ChatMemberRow[] }>(
        `/chats/manage/${chatId}/members`,
        { params: { limit: 100 } },
    );
    return response.data.data;
}

/**
 * `POST /chats/manage/ban/:memberId` — owner-only on the backend (chat role
 * `manager`; admins are rejected). The member's role becomes `ban`.
 */
export async function banChatMember(memberId: number): Promise<void> {
    await httpClient.post(`/chats/manage/ban/${memberId}`);
}

/**
 * `POST /chats/:chatId/leave` → `{ message, chatId }`.
 * The backend rejects the group owner (`manager` chat role, 400 — ownership
 * transfer is not supported) and non-members/banned callers (403).
 */
export async function leaveGroup(
    chatId: number,
): Promise<{ message: string; chatId: number }> {
    const response = await httpClient.post<{
        message: string;
        chatId: number;
    }>(`/chats/${chatId}/leave`);
    return response.data;
}

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
