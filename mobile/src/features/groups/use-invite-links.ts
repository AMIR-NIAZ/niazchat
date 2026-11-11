import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../core/api';
import { CHATS_QUERY_KEY } from '../chats/use-chats';
import * as api from './invite-links-api';
import type {
    InviteCreateInput,
    InviteLinkDto,
    InviteLinksPage,
    InvitePreview,
    JoinInviteResult,
} from './invite-links-model';
import { inviteLinksQueryKey } from './invite-links-model';

function retryUnlessGone(failureCount: number, error: Error): boolean {
    if (
        error instanceof ApiError &&
        (error.statusCode === 403 || error.statusCode === 404)
    ) {
        return false;
    }
    return failureCount < 2;
}

function patchPage(
    queryClient: QueryClient,
    chatId: number,
    update: (page: InviteLinksPage) => InviteLinksPage,
): void {
    queryClient.setQueryData<InviteLinksPage>(
        inviteLinksQueryKey(chatId),
        (current) => (current === undefined ? current : update(current)),
    );
}

export function useInviteLinks(chatId: number, enabled: boolean = true) {
    return useQuery<InviteLinksPage>({
        queryKey: inviteLinksQueryKey(chatId),
        queryFn: (): Promise<InviteLinksPage> => api.fetchInviteLinks(chatId),
        staleTime: 0,
        retry: retryUnlessGone,
        enabled: enabled && chatId > 0,
    });
}

export function useCreateInviteLink(chatId: number) {
    const queryClient = useQueryClient();
    return useMutation<InviteLinkDto, Error, InviteCreateInput>({
        mutationFn: (input): Promise<InviteLinkDto> =>
            api.createInviteLink(chatId, input),
        onSuccess: (created): void => {
            patchPage(queryClient, chatId, (page) => ({
                ...page,
                items: [
                    created,
                    ...page.items.filter((item) => item.id !== created.id),
                ],
                activeCount: page.activeCount + 1,
            }));
            void queryClient.invalidateQueries({
                queryKey: inviteLinksQueryKey(chatId),
            });
        },
    });
}

export function useRevokeInviteLink(chatId: number) {
    const queryClient = useQueryClient();
    return useMutation<
        { id: number; status: 'revoked'; changed: boolean },
        Error,
        number
    >({
        mutationFn: (
            linkId,
        ): Promise<{
            id: number;
            status: 'revoked';
            changed: boolean;
        }> => api.revokeInviteLink(chatId, linkId),
        onSuccess: (result): void => {
            patchPage(queryClient, chatId, (page) => {
                const before = page.items.find((item) => item.id === result.id);
                const wasActive = before?.status === 'active';
                return {
                    ...page,
                    items: page.items.map((item) =>
                        item.id === result.id
                            ? {
                                  ...item,
                                  status: 'revoked' as const,
                                  revokedAt: new Date().toISOString(),
                              }
                            : item,
                    ),
                    activeCount: wasActive
                        ? Math.max(0, page.activeCount - 1)
                        : page.activeCount,
                };
            });
            void queryClient.invalidateQueries({
                queryKey: inviteLinksQueryKey(chatId),
            });
        },
    });
}

export function useInvitePreview(code: string | null, enabled: boolean = true) {
    return useQuery<InvitePreview>({
        queryKey: ['invite-preview', code] as const,
        queryFn: (): Promise<InvitePreview> => api.previewInvite(code ?? ''),
        staleTime: 0,
        retry: retryUnlessGone,
        enabled: enabled && code !== null,
    });
}

export function useJoinInvite(code: string) {
    const queryClient = useQueryClient();
    return useMutation<JoinInviteResult, Error, void>({
        mutationFn: (): Promise<JoinInviteResult> => api.joinInvite(code),
        onSuccess: (result): void => {
            void queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY });
            void queryClient.invalidateQueries({
                queryKey: ['group', result.chatId],
            });
        },
    });
}
