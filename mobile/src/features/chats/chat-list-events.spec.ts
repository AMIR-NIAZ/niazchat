import { applyChatBlockedEvent, removeChatFromList } from './chat-list-events';
import type { ChatPreview } from './chats-model';

function chat(overrides: Partial<ChatPreview> = {}): ChatPreview {
    return {
        id: 11,
        type: 'private',
        title: null,
        peer: {
            id: 42,
            name: 'Ali',
            username: 'ali',
            avatars: [],
            isOnline: false,
            lastSeen: null,
        },
        isBan: false,
        avatarUrls: [],
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
        lastMessage: null,
        unreadCount: 0,
        ...overrides,
    };
}

describe('applyChatBlockedEvent', () => {
    it('sets the caller-side block flag from the ack/event', () => {
        const rows = [chat()];
        const next = applyChatBlockedEvent(rows, {
            chatId: 11,
            blockedByMe: true,
            blockedMe: false,
            blocked: true,
        });
        expect(next[0]?.blockedByMe).toBe(true);
        expect(next[0]?.blockedMe).toBe(false);
    });

    it('keeps the peer-side flag when only the caller unblocks', () => {
        const rows = [chat({ blockedByMe: true, blockedMe: true })];
        const next = applyChatBlockedEvent(rows, {
            chatId: 11,
            blockedByMe: false,
            blockedMe: true,
            blocked: true,
        });
        expect(next[0]?.blockedByMe).toBe(false);
        expect(next[0]?.blockedMe).toBe(true);
    });

    it('returns the same array when nothing changed (no republish)', () => {
        const rows = [chat({ blockedByMe: true })];
        expect(
            applyChatBlockedEvent(rows, {
                chatId: 11,
                blockedByMe: true,
                blockedMe: false,
            }),
        ).toBe(rows);
    });

    it('ignores events for chats that are not cached', () => {
        const rows = [chat()];
        expect(
            applyChatBlockedEvent(rows, {
                chatId: 999,
                blockedByMe: true,
                blockedMe: false,
            }),
        ).toBe(rows);
    });
});

describe('removeChatFromList', () => {
    it('removes the deleted row and keeps the others', () => {
        const next = removeChatFromList([chat(), chat({ id: 12 })], 11);
        expect(next.map((row) => row.id)).toEqual([12]);
    });

    it('is idempotent for a duplicate delete event', () => {
        const rows = [chat({ id: 12 })];
        expect(removeChatFromList(rows, 11)).toBe(rows);
    });
});
