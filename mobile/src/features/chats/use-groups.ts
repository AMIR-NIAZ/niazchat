import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSocket } from '../../core/socket';
import type { ChatDto } from '../../core/api';
import { absoluteUploadUrl } from '../../core/config/env';
import { CHATS_QUERY_KEY } from './use-chats';
import * as groupsService from './groups-service';
import { joinChat } from './chats-socket-api';
import type { ChatInfo } from './chats-model';

/**
 * Group-related server state.
 *
 * Cache invalidation strategy (per docs): `POST /chats/create` returns no chat
 * id, so after a successful create we invalidate the chat list; fresh rows then
 * arrive over the WS `getAllChats` event when the query refetches.
 */

export function useInvalidateChats(): () => void {
    const queryClient = useQueryClient();
    return () => {
        void queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY });
    };
}

export function useCreateGroup() {
    const invalidate = useInvalidateChats();
    return useMutation({
        mutationFn: (payload: {
            title: string;
            members?: string[];
        }): Promise<void> => groupsService.createGroup(payload),
        onSuccess: invalidate,
    });
}

export function useAddMemberByPhone() {
    return useMutation({
        mutationFn: (variables: {
            groupId: number;
            phone: string;
        }): Promise<void> =>
            groupsService.addMemberByPhone(variables.groupId, variables.phone),
    });
}

export function useBannedMembers(chatId: number, enabled: boolean) {
    return useQuery({
        queryKey: ['chats', 'bans', chatId] as const,
        queryFn: (): Promise<BannedChatMemberDtoRow[]> =>
            groupsService.listBannedMembers(chatId),
        enabled,
        retry: false,
    });
}

type BannedChatMemberDtoRow = Awaited<
    ReturnType<typeof groupsService.listBannedMembers>
>[number];

export function useGroupAvatarUpload() {
    return useMutation({
        mutationFn: (variables: {
            chatId: number;
            fileUri: string;
        }): Promise<void> =>
            groupsService.uploadGroupAvatar(
                variables.chatId,
                variables.fileUri,
            ),
    });
}

/**
 * Opens a chat room over the shared socket and resolves two WS events:
 * `chatInfo` (raw Chat entity) and `getMessages` (history — presented only as
 * a count here; the messaging feature owns the UI).
 */
export function useChatDetail(chatId: number) {
    return useQuery({
        queryKey: ['chat-info', chatId] as const,
        queryFn: async (): Promise<ChatInfo | null> => {
            // joinChat's ack data IS the chat info (no event chaining).
            const info = await joinChat(chatId);
            return info === null ? null : parseChatInfo(info);
        },
        retry: false,
    });
}

function parseChatInfo(raw: ChatDto): ChatInfo {
    return {
        id: raw.id,
        type: raw.type,
        title: raw.title,
        isBan: raw.isBan,
        avatarUrls: raw.avatars.map(absoluteUploadUrl),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
    };
}

/**
 * Leaves the chat room on unmount (server triggers `typing:stop` + `seen`).
 * The chat id travels with the request so a late unmount cleanup from a
 * previously open screen cannot remove the user from the chat they just joined
 * (the backend ignores a leave whose chat id is not the current one).
 */
export function useLeaveChatRoomOnUnmount(chatId: number): void {
    useEffect(() => {
        return () => {
            const socket = getSocket();
            if (socket === null || chatId <= 0) {
                return;
            }
            socket.emit('leaveChat', { chatId }, () => {});
        };
    }, [chatId]);
}
