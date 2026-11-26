import { appQueryClient } from '../../core/query/query-client';
import { runSessionCleanups } from '../../core/session/cleanup-registry';
import { disconnectSocket } from '../../core/socket';
import { resetMessagesMirrorState } from '../../shared/local-db';
import { setActiveChat } from '../chats/active-chat';
import { resetChatRoomState } from '../chats/active-room';
import { clearPendingInviteCode } from '../groups/pending-invite';
import { cancelSessionRefresh } from './session-refresh';
import { forgetCachedTokens } from './token-service';

/**
 * Drops everything an account left in MEMORY: the refresh request and timers,
 * playback/uploads (registered cleanup hooks), the socket, the access-token
 * mirror, the active chat/room markers and the whole TanStack Query cache.
 *
 * Persisted data is deliberately untouched here — it is keyed by userId, so the
 * next account can never read it, and a switch must keep the other account
 * signed in. Logout removes the specific user's persisted data separately.
 */
export function resetInMemorySession(): void {
    cancelSessionRefresh();
    clearPendingInviteCode();
    runSessionCleanups();
    disconnectSocket();
    forgetCachedTokens();
    setActiveChat(null, false);
    resetChatRoomState();
    resetMessagesMirrorState();
    appQueryClient.clear();
}
