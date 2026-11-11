import {
    chatRoomName,
    clearChatRoom,
    getActiveRoomChatId,
    getFocusedChatId,
    markChatBlurred,
    markChatFocused,
    markChatRoomJoined,
    needsChatRoomJoin,
    resetChatRoomState,
} from './active-room';

/**
 * The shared socket can be in exactly ONE chat room (backend `joinChat` leaves
 * the previous room). These tests pin the bookkeeping that decides when the
 * visible chat must re-join so read receipts keep flowing after navigation.
 */

describe('active chat room tracking', () => {
    beforeEach(() => {
        resetChatRoomState();
    });

    it('uses the backend room name', () => {
        expect(chatRoomName(42)).toBe('chat:42');
    });

    it('Test 2/3 — after focus moves to another chat and back, the visible chat is not considered joined', () => {
        markChatFocused(1);
        markChatRoomJoined(1);

        // Chat 2 pushed on top: chat 1 blurs, chat 2 owns the room.
        markChatBlurred(1);
        markChatFocused(2);
        markChatRoomJoined(2);
        expect(getFocusedChatId()).toBe(2);
        expect(getActiveRoomChatId()).toBe(2);

        // Pop back: chat 2 blurs/releases, chat 1 is focused again but the
        // socket's active room is no longer chat 1, so it must re-join.
        expect(clearChatRoom(2)).toBe(true);
        markChatBlurred(2);
        markChatFocused(1);
        expect(getActiveRoomChatId()).toBeNull();
        expect(
            needsChatRoomJoin({
                chatId: 1,
                activeRoomChatId: getActiveRoomChatId(),
                initialJoinPending: false,
                loading: false,
                syncing: false,
            }),
        ).toBe(true);

        // After re-joining it is a no-op.
        markChatRoomJoined(1);
        expect(
            needsChatRoomJoin({
                chatId: 1,
                activeRoomChatId: getActiveRoomChatId(),
                initialJoinPending: false,
                loading: false,
                syncing: false,
            }),
        ).toBe(false);

        // A blur must force one resync even if another screen re-joined the
        // same room while this one was hidden (messages may have arrived).
        expect(
            needsChatRoomJoin({
                chatId: 1,
                activeRoomChatId: getActiveRoomChatId(),
                initialJoinPending: false,
                loading: false,
                syncing: false,
                syncRequired: true,
            }),
        ).toBe(true);
    });

    it('a stale blur/unmount of an underlying screen cannot release the room on top', () => {
        markChatFocused(2);
        markChatRoomJoined(2);

        // Chat 1 (mounted underneath) must not clear chat 2's ownership.
        expect(clearChatRoom(1)).toBe(false);
        markChatBlurred(1);
        expect(getActiveRoomChatId()).toBe(2);
        expect(getFocusedChatId()).toBe(2);
    });

    it('skips the first focus (the conversation query performs that join)', () => {
        markChatFocused(1);
        expect(
            needsChatRoomJoin({
                chatId: 1,
                activeRoomChatId: null,
                initialJoinPending: true,
                loading: true,
                syncing: false,
            }),
        ).toBe(false);
    });

    it('does not stack joins while one is loading or already syncing', () => {
        const base = {
            chatId: 1,
            activeRoomChatId: null,
            initialJoinPending: false,
            loading: false,
            syncing: false,
        };
        expect(needsChatRoomJoin(base)).toBe(true);
        expect(needsChatRoomJoin({ ...base, loading: true })).toBe(false);
        expect(needsChatRoomJoin({ ...base, syncing: true })).toBe(false);
        expect(needsChatRoomJoin({ ...base, chatId: null })).toBe(false);
    });

    it('Test 4 — a disconnect invalidates the room membership (rooms are per connection)', () => {
        markChatFocused(1);
        markChatRoomJoined(1);

        resetChatRoomState();
        expect(getActiveRoomChatId()).toBeNull();
        expect(getFocusedChatId()).toBeNull();
    });
});
