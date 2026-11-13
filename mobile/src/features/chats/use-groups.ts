import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSocket } from '../../core/socket';
import type { ChatDto } from '../../core/api';
import type { ChatRole } from '../../core/api/dto/chat.dto';
import { absoluteUploadUrl } from '../../core/config/env';
import { CHATS_QUERY_KEY } from './use-chats';
import { clearChatRoom } from './active-room';
import * as groupsService from './groups-service';
import { joinChat } from './chats-socket-api';
import { toChatPeer } from './chats-mapper';
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

/**
 * The caller's own chat role for one group, from the members endpoint extras.
 * Used only to gate the owner's Leave action; the backend remains the final
 * authority. `null` means banned/unknown.
 *
 * Read through the query cache (the chat-list popup prefetches it on hold), so
 * the menu can be built synchronously without a subscribing hook.
 */
export const MY_CHAT_ROLE_QUERY_KEY = 'my-role' as const;

export function myChatRoleQuery(chatId: number): {
    queryKey: readonly ['chats', 'my-role', number];
    queryFn: () => Promise<ChatRole | null>;
    staleTime: number;
} {
    return {
        queryKey: ['chats', MY_CHAT_ROLE_QUERY_KEY, chatId] as const,
        queryFn: (): Promise<ChatRole | null> =>
            groupsService.getMyChatRole(chatId),
        staleTime: 60_000,
    };
}

/**
 * `POST /chats/:chatId/leave` — the caller leaves the group.
 *
 * No optimistic membership change: callers must treat the ack as the only
 * confirmation (the owner can be rejected server-side even if the cached role
 * says otherwise). Cache cleanup belongs to the screen, which also drops the
 * conversation cache and navigates away.
 */
export function useLeaveGroup() {
    return useMutation({
        mutationFn: (chatId: number): Promise<{ message: string }> =>
            groupsService.leaveGroup(chatId),
    });
}

/** Active members of a group (owner moderation list). */
export function useChatMembers(chatId: number, enabled: boolean) {
    return useQuery({
        queryKey: ['chats', 'members', chatId] as const,
        queryFn: (): Promise<ChatMemberRow[]> =>
            groupsService.listChatMembers(chatId),
        enabled,
        retry: false,
    });
}

type ChatMemberRow = Awaited<
    ReturnType<typeof groupsService.listChatMembers>
>[number];

/** Owner-only ban; refreshes both the member and banned-member lists. */
export function useBanChatMember(chatId: number) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (memberId: number): Promise<void> =>
            groupsService.banChatMember(memberId),
        onSuccess: async (): Promise<void> => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ['chats', 'members', chatId],
                }),
                queryClient.invalidateQueries({
                    queryKey: ['chats', 'bans', chatId],
                }),
            ]);
        },
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
            const joined = await joinChat(chatId);
            return joined === null || joined.info === null
                ? null
                : parseChatInfo(joined.info);
        },
        retry: false,
    });
}

function parseChatInfo(raw: ChatDto): ChatInfo {
    return {
        id: Number(raw.id),
        type: raw.type,
        title: raw.title ?? null,
        peer: toChatPeer(raw.peer),
        isBan: raw.isBan,
        avatarUrls: raw.avatars.map(absoluteUploadUrl),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        myLastSeenId:
            raw.myLastSeenId === null || raw.myLastSeenId === undefined
                ? null
                : Number(raw.myLastSeenId),
        othersLastSeenId:
            raw.othersLastSeenId === null || raw.othersLastSeenId === undefined
                ? null
                : Number(raw.othersLastSeenId),
        membersCount:
            raw.membersCount === null || raw.membersCount === undefined
                ? null
                : Number(raw.membersCount),
    };
}

/**
 * Leaves the chat room when the screen unmounts (server triggers `typing:stop`
 * + `online` bookkeeping). Only the screen that currently OWNS the socket's
 * room may leave it: `clearChatRoom` returns false for a stale unmount of an
 * underlying screen whose chat is no longer the active one, so popping a
 * duplicate route can never kick the visible chat out of its room. The chat id
 * also travels with the request (the backend ignores a leave for another
 * chat).
 */
export function useLeaveChatRoomOnUnmount(chatId: number): void {
    useEffect(() => {
        return () => {
            if (chatId <= 0 || !clearChatRoom(chatId)) {
                return;
            }
            const socket = getSocket();
            if (socket === null || !socket.connected) {
                return;
            }
            socket.emit('leaveChat', { chatId }, () => {});
        };
    }, [chatId]);
}
