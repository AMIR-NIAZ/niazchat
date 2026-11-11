import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSocketEvent } from '../../core/socket';
import { ApiError } from '../../core/api';
import { describeMemberActionError } from './group-errors';
import { CHATS_QUERY_KEY } from '../chats/use-chats';
import type { ChatInfo, ChatPreview } from '../chats/chats-model';
import { messagesQueryKey } from '../messages/use-chat-messages';
import type { ConversationDetail } from '../messages/use-chat-messages';
import { absoluteUploadUrl } from '../../core/config/env';
import type { ProfileAvatar } from '../users/use-profile';
import * as api from './groups-api';
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
import {
    GROUP_INFO_STALE_TIME_MS,
    GROUP_MEMBERS_STALE_TIME_MS,
    groupInfoQueryKey,
    groupMembersPrefix,
    groupMembersQueryKey,
    memberPermissionsPrefix,
    memberPermissionsQueryKey,
    patchMembersPages,
} from './group-model';

type MemberPages = InfiniteData<GroupMemberPage, string | null>;

export function useGroupInfo(chatId: number, enabled: boolean = true) {
    return useQuery<GroupInfo>({
        queryKey: groupInfoQueryKey(chatId),
        queryFn: (): Promise<GroupInfo> => api.fetchGroupInfo(chatId),
        staleTime: GROUP_INFO_STALE_TIME_MS,
        retry: false,
        enabled: enabled && chatId > 0,
    });
}

interface GroupInfoPatch {
    title?: string;
    description?: string | null;
    avatars?: string[];
}

/**
 * Applies one committed title/description/photo change to every cache that
 * renders it: the group info, the chat list row, the chat-info query and the
 * open conversation (`detail.info` drives the chat header).
 */
function applyGroupInfoPatch(
    queryClient: QueryClient,
    chatId: number,
    patch: GroupInfoPatch,
): void {
    const avatarUrls =
        patch.avatars === undefined
            ? undefined
            : patch.avatars.map(absoluteUploadUrl);

    queryClient.setQueryData<GroupInfo>(groupInfoQueryKey(chatId), (current) =>
        current === undefined
            ? current
            : {
                  ...current,
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.description !== undefined
                      ? { description: patch.description }
                      : {}),
                  ...(patch.avatars !== undefined
                      ? { avatars: patch.avatars }
                      : {}),
              },
    );

    queryClient.setQueryData<ChatPreview[]>(CHATS_QUERY_KEY, (current) =>
        current === undefined
            ? current
            : current.map((chat) =>
                  Number(chat.id) === chatId
                      ? {
                            ...chat,
                            ...(patch.title !== undefined
                                ? { title: patch.title }
                                : {}),
                            ...(avatarUrls !== undefined ? { avatarUrls } : {}),
                        }
                      : chat,
              ),
    );

    queryClient.setQueryData<ChatInfo | null>(
        ['chat-info', chatId],
        (current) => {
            if (current === null || current === undefined) return current;
            return {
                ...current,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(avatarUrls !== undefined ? { avatarUrls } : {}),
            };
        },
    );

    queryClient.setQueryData<ConversationDetail>(
        messagesQueryKey(chatId),
        (current) => {
            if (current === undefined || current.info === null) return current;
            return {
                ...current,
                info: {
                    ...current.info,
                    ...(patch.title !== undefined
                        ? { title: patch.title }
                        : {}),
                    ...(patch.avatars !== undefined
                        ? { avatars: patch.avatars }
                        : {}),
                },
            };
        },
    );
}

async function invalidateGroupInfoDependents(
    queryClient: QueryClient,
    chatId: number,
): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: groupInfoQueryKey(chatId),
        }),
        queryClient.invalidateQueries({ queryKey: ['chat-info', chatId] }),
        queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY }),
    ]);
}

/** Saves only the changed text fields in ONE PATCH. */
export function useUpdateGroupInfo(chatId: number) {
    const queryClient = useQueryClient();
    return useMutation<GroupInfoUpdateResponse, Error, GroupInfoChanges>({
        mutationFn: (changes): Promise<GroupInfoUpdateResponse> =>
            api.updateGroupInfo(chatId, changes),
        onSuccess: async (result): Promise<void> => {
            applyGroupInfoPatch(queryClient, chatId, {
                title: result.title,
                description: result.description,
                avatars: result.avatars,
            });
            await invalidateGroupInfoDependents(queryClient, chatId);
        },
    });
}

/** Stored paths → `{ fileName, url }` pairs for the gallery/viewer. */
export function groupAvatarItems(
    avatars: string[] | null | undefined,
): ProfileAvatar[] {
    return (avatars ?? []).map((storedPath) => ({
        fileName: storedPath.split('/').pop() ?? storedPath,
        url: absoluteUploadUrl(storedPath),
    }));
}

export function useUploadGroupAvatar(chatId: number) {
    const queryClient = useQueryClient();
    return useMutation<
        GroupAvatarMutationResponse,
        Error,
        api.GroupAvatarUploadAsset
    >({
        mutationFn: (asset): Promise<GroupAvatarMutationResponse> =>
            api.uploadGroupAvatar(chatId, asset),
        onSuccess: async (result): Promise<void> => {
            applyGroupInfoPatch(queryClient, chatId, {
                avatars: result.avatars,
            });
            await invalidateGroupInfoDependents(queryClient, chatId);
        },
    });
}

export function useDeleteGroupAvatar(chatId: number) {
    const queryClient = useQueryClient();
    return useMutation<GroupAvatarMutationResponse, Error, string>({
        mutationFn: (fileName: string): Promise<GroupAvatarMutationResponse> =>
            api.deleteGroupAvatar(chatId, fileName),
        onSuccess: async (result): Promise<void> => {
            applyGroupInfoPatch(queryClient, chatId, {
                avatars: result.avatars,
            });
            await invalidateGroupInfoDependents(queryClient, chatId);
        },
    });
}

export function useSetMainGroupAvatar(chatId: number) {
    const queryClient = useQueryClient();
    return useMutation<GroupAvatarMutationResponse, Error, string>({
        mutationFn: (fileName: string): Promise<GroupAvatarMutationResponse> =>
            api.setMainGroupAvatar(chatId, fileName),
        onSuccess: async (result): Promise<void> => {
            applyGroupInfoPatch(queryClient, chatId, {
                avatars: result.avatars,
            });
            await invalidateGroupInfoDependents(queryClient, chatId);
        },
    });
}

export function useGroupMembers(chatId: number, search: string) {
    return useInfiniteQuery<
        GroupMemberPage,
        Error,
        MemberPages,
        readonly [string, number, string, string],
        string | null
    >({
        queryKey: groupMembersQueryKey(chatId, search),
        queryFn: ({ pageParam }): Promise<GroupMemberPage> =>
            api.fetchGroupMembers(chatId, {
                search,
                cursor: pageParam,
            }),
        initialPageParam: null,
        getNextPageParam: (last): string | null =>
            last.nextCursor === '' ? null : last.nextCursor,
        staleTime: GROUP_MEMBERS_STALE_TIME_MS,
        retry: false,
        enabled: chatId > 0,
    });
}

export function useMemberPermissions(
    chatId: number,
    memberId: number,
    enabled: boolean,
) {
    return useQuery<MemberPermissions>({
        queryKey: memberPermissionsQueryKey(chatId, memberId),
        queryFn: (): Promise<MemberPermissions> =>
            api.fetchMemberPermissions(chatId, memberId),
        staleTime: 0,
        retry: (failureCount, error): boolean => {
            if (
                error instanceof ApiError &&
                (error.statusCode === 403 ||
                    error.statusCode === 404 ||
                    error.statusCode === 409)
            ) {
                return false;
            }
            return failureCount < 2;
        },
        enabled: enabled && chatId > 0 && memberId > 0,
    });
}

export function useSetMemberPermissions(chatId: number, memberId: number) {
    const queryClient = useQueryClient();
    return useMutation<MemberPermissionsUpdate, Error, MemberPermissionKey[]>({
        mutationFn: (permissions): Promise<MemberPermissionsUpdate> =>
            api.updateMemberPermissions(chatId, memberId, permissions),
        onSuccess: (result): void => {
            queryClient.setQueryData<MemberPermissions>(
                memberPermissionsQueryKey(chatId, memberId),
                (current) =>
                    current === undefined
                        ? current
                        : {
                              ...current,
                              granted: result.granted,
                              hasAll: false,
                          },
            );
            void queryClient.invalidateQueries({
                queryKey: memberPermissionsQueryKey(chatId, memberId),
            });
            // A caller's own `canRemove` changes immediately; refetch actions.
            void queryClient.invalidateQueries({
                queryKey: groupMembersPrefix(chatId),
            });
        },
    });
}

/** Refetches the info and every member page when the screen regains focus. */
export function useRefetchGroupOnFocus(
    refetchInfo: () => unknown,
    refetchMembers: () => unknown,
): void {
    useFocusEffect(
        useCallback((): void => {
            void refetchInfo();
            void refetchMembers();
        }, [refetchInfo, refetchMembers]),
    );
}

export { describeMemberActionError };

function updateMemberCaches(
    queryClient: QueryClient,
    chatId: number,
    result: MemberActionResponse,
): void {
    queryClient.setQueriesData<MemberPages>(
        { queryKey: groupMembersPrefix(chatId) },
        (current) =>
            current === undefined
                ? current
                : {
                      ...current,
                      pages: patchMembersPages(
                          current.pages,
                          result.memberId,
                          result.role,
                      ),
                  },
    );

    if (result.role !== null) {
        queryClient.setQueryData<GroupInfo>(
            groupInfoQueryKey(chatId),
            (current) =>
                current === undefined
                    ? current
                    : {
                          ...current,
                          membersCount: current.membersCount,
                      },
        );
    } else {
        queryClient.setQueryData<GroupInfo>(
            groupInfoQueryKey(chatId),
            (current) =>
                current === undefined
                    ? current
                    : {
                          ...current,
                          membersCount: Math.max(0, current.membersCount - 1),
                      },
        );
        void queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY });
    }
}

function useMemberMutation(
    chatId: number,
    mutationFn: (memberId: number) => Promise<MemberActionResponse>,
) {
    const queryClient = useQueryClient();
    return useMutation<MemberActionResponse, Error, number>({
        mutationFn,
        onSuccess: async (result): Promise<void> => {
            // Immediate row update, then authoritative refetch (actions matrix
            // may change for other rows when the caller's role changes).
            updateMemberCaches(queryClient, chatId, result);
            await queryClient.invalidateQueries({
                queryKey: groupInfoQueryKey(chatId),
            });
            await queryClient.invalidateQueries({
                queryKey: groupMembersPrefix(chatId),
            });
        },
    });
}

export function usePromoteMember(chatId: number) {
    return useMemberMutation(chatId, (memberId) =>
        api.promoteMember(chatId, memberId),
    );
}

export function useDemoteMember(chatId: number) {
    return useMemberMutation(chatId, (memberId) =>
        api.demoteMember(chatId, memberId),
    );
}

export function useRemoveMember(chatId: number) {
    return useMemberMutation(chatId, (memberId) =>
        api.removeMember(chatId, memberId),
    );
}

export interface GroupChangedEvent {
    chatId: number;
    reason:
        | 'role_changed'
        | 'member_removed'
        | 'permissions_changed'
        | 'info_changed'
        | 'avatars_changed'
        | 'invite_links_changed'
        | 'member_joined';
    userId?: number;
}

export interface GroupUpdatedEvent {
    chatId: number;
    title: string;
    avatars: string[];
}

/**
 * `group:updated { chatId, title, avatars }` arrives in the caller's personal
 * room after any group info change, so an open chat/list refreshes even when
 * it is not inside the chat room. Listener binds to the CURRENT socket only.
 */
export function useGroupUpdatedEvents(): void {
    const queryClient = useQueryClient();
    const handler = useCallback(
        (payload: GroupUpdatedEvent): void => {
            const chatId = Number(payload.chatId);
            if (!Number.isInteger(chatId) || chatId <= 0) return;
            applyGroupInfoPatch(queryClient, chatId, {
                title: payload.title,
                avatars: Array.isArray(payload.avatars) ? payload.avatars : [],
            });
            void queryClient.invalidateQueries({
                queryKey: groupInfoQueryKey(chatId),
            });
        },
        [queryClient],
    );
    useSocketEvent('group:updated', handler);
}

/**
 * Live group changes for the OPEN group: refetches info + member pages.
 * Registers on the current socket instance only (the `socket` dependency
 * re-attaches on replacement and the cleanup prevents duplicates).
 */
export function useGroupChangedEvents(chatId: number): void {
    const queryClient = useQueryClient();

    const handler = useCallback(
        (payload: GroupChangedEvent): void => {
            if (Number(payload.chatId) !== chatId) return;
            void queryClient.invalidateQueries({
                queryKey: groupInfoQueryKey(chatId),
            });
            void queryClient.invalidateQueries({
                queryKey: groupMembersPrefix(chatId),
            });
            void queryClient.invalidateQueries({
                queryKey: memberPermissionsPrefix(chatId),
            });
            if (
                payload.reason === 'invite_links_changed' ||
                payload.reason === 'member_joined'
            ) {
                void queryClient.invalidateQueries({
                    queryKey: ['group', chatId, 'invite-links'],
                });
            }
            if (
                payload.reason === 'info_changed' ||
                payload.reason === 'avatars_changed'
            ) {
                void queryClient.invalidateQueries({
                    queryKey: ['chat-info', chatId],
                });
                void queryClient.invalidateQueries({
                    queryKey: CHATS_QUERY_KEY,
                });
            }
        },
        [chatId, queryClient],
    );
    useSocketEvent('group:changed', handler);
}

/** Guard against both the chat and group screens reacting to one event. */
let handledRemoval: { chatId: number; at: number } | null = null;

export function markRemovalHandled(chatId: number): boolean {
    const now = Date.now();
    if (
        handledRemoval !== null &&
        handledRemoval.chatId === chatId &&
        now - handledRemoval.at < 3000
    ) {
        return false;
    }
    handledRemoval = { chatId, at: now };
    return true;
}

/** Visible for tests: reset the dedupe guard. */
export function resetRemovalGuard(): void {
    handledRemoval = null;
}

/**
 * `group:removed` for the chat currently open: drop every local trace of the
 * group and replace the screen with the chat list. The caller supplies the
 * navigation so the chat screen and the group screen share one behavior.
 */
export function useGroupRemovedEvent(
    chatId: number,
    onRemoved: () => void,
): void {
    const handler = useCallback(
        (payload: { chatId: number }): void => {
            if (Number(payload.chatId) !== chatId) return;
            if (!markRemovalHandled(chatId)) return;
            onRemoved();
        },
        [chatId, onRemoved],
    );
    useSocketEvent('group:removed', handler);
}

/** True when the current member row belongs to the signed-in user. */
export function isOwnMemberRow(
    member: GroupMember,
    currentUserId: number | null,
): boolean {
    return currentUserId !== null && member.userId === currentUserId;
}
