import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ChatPreview } from '../chats/chats-model';
import { CHATS_QUERY_KEY } from '../chats/use-chats';
import { groupInfoQueryKey } from './group-model';
import type { GroupInfo } from './group-model';
import { useGroupInfo } from './use-group';

/**
 * One answer to "what is my relationship to this group?" for every screen that
 * could otherwise show the join flow (invite link preview/join, search group
 * rows, group cards).
 *
 * Order of truth:
 *   1. the cached chat list — the caller's own chats, available offline. A row
 *      means member (its `isBan` flag means banned); a loaded list without the
 *      row means not-member.
 *   2. an explicit server answer (`isMember` / `myRole` on a link preview, the
 *      group-info `myRole`), which is the only way to tell BANNED apart from
 *      never-joined when the chat-list cache is cold.
 *   3. `unknown` while nothing has answered yet — callers render a loading
 *      state and never the join button.
 */

export type GroupMembership = 'member' | 'banned' | 'not-member' | 'unknown';

export interface GroupMembershipHint {
    isMember?: boolean | null | undefined;
    /** Wire role: `manager`/`owner`/`admin`/`user`/`member`/`ban`. */
    myRole?: string | null | undefined;
}

export function toChatId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** `ban`/`banned` → banned; any other known role → member. */
export function membershipFromRole(
    role: string | null | undefined,
): GroupMembership | null {
    switch (role) {
        case 'ban':
        case 'banned':
            return 'banned';
        case 'manager':
        case 'owner':
        case 'admin':
        case 'user':
        case 'member':
            return 'member';
        default:
            return null;
    }
}

export function hintMembership(
    hint: GroupMembershipHint | null | undefined,
): GroupMembership | null {
    const fromRole = membershipFromRole(hint?.myRole);
    if (fromRole !== null) return fromRole;
    if (hint?.isMember === true) return 'member';
    if (hint?.isMember === false) return 'not-member';
    return null;
}

/**
 * Membership from the cached chat list only. `null` means the list itself is
 * not loaded yet (or the id is unusable), so the cache cannot answer.
 */
export function chatListMembership(
    queryClient: QueryClient,
    chatId: number | null,
): GroupMembership | null {
    if (chatId === null) return null;
    const chats = queryClient.getQueryData<ChatPreview[]>(CHATS_QUERY_KEY);
    if (chats === undefined) return null;
    const row = chats.find((chat) => Number(chat.id) === chatId);
    if (row === undefined) return 'not-member';
    return row.isBan ? 'banned' : 'member';
}

/**
 * Pure synchronous answer from what is already cached. Used by handlers that
 * must decide before navigating (search rows, chat cards) and by the hook.
 */
export function getMembership(
    chatId: number | null,
    queryClient: QueryClient,
    hint?: GroupMembershipHint | null,
): GroupMembership {
    const cached = chatListMembership(queryClient, chatId);
    if (cached === 'member' || cached === 'banned') return cached;

    const hinted = hintMembership(hint);
    if (hinted !== null) return hinted;

    if (chatId !== null) {
        const info = queryClient.getQueryData<GroupInfo>(
            groupInfoQueryKey(chatId),
        );
        const fromInfo = membershipFromRole(info?.myRole);
        if (fromInfo !== null) return fromInfo;
    }

    return cached ?? 'unknown';
}

/**
 * Reactive wrapper around `getMembership`. When neither the chat list nor the
 * caller's server answer can decide, it asks the group-info endpoint (a
 * non-member gets 403, which is a final `not-member`). It returns `unknown`
 * while that request is in flight.
 */
export function useGroupMembership(
    chatId: number | null,
    options: {
        enabled?: boolean;
        hint?: GroupMembershipHint | null;
    } = {},
): GroupMembership {
    const queryClient = useQueryClient();
    const id = toChatId(chatId);
    const cached = chatListMembership(queryClient, id);
    const hinted = hintMembership(options.hint ?? null);
    const needsServer =
        options.enabled !== false &&
        id !== null &&
        cached === null &&
        hinted === null;

    const infoQuery = useGroupInfo(id ?? 0, needsServer);
    const fromInfo = membershipFromRole(infoQuery.data?.myRole);

    if (fromInfo === 'banned') return 'banned';
    if (fromInfo === 'member') return 'member';
    if (hinted !== null) return hinted;
    if (cached !== null && cached !== 'not-member') return cached;
    if (needsServer) {
        return infoQuery.isError ? 'not-member' : 'unknown';
    }
    if (cached === 'not-member') return 'not-member';
    return 'unknown';
}
