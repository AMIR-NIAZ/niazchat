/// <reference types="jest" />
import { getChatDisplay, isPrivateChat, type ChatPreview } from './chats-model';

function preview(overrides: Partial<ChatPreview>): ChatPreview {
    return {
        id: 1,
        type: 'groupe',
        title: 'Team',
        peerName: null,
        peer: null,
        isBan: false,
        avatarUrls: ['https://cdn/group.png'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastMessage: null,
        unreadCount: 0,
        ...overrides,
    };
}

describe('isPrivateChat', () => {
    it('is true only for the server private type', () => {
        expect(isPrivateChat({ type: 'private' })).toBe(true);
        expect(isPrivateChat({ type: 'groupe' })).toBe(false);
        expect(isPrivateChat({ type: 'channel' })).toBe(false);
        expect(isPrivateChat(null)).toBe(false);
        expect(isPrivateChat(undefined)).toBe(false);
        expect(isPrivateChat({})).toBe(false);
    });
});

describe('getChatDisplay', () => {
    it('uses the group title and current group photo', () => {
        expect(getChatDisplay(preview({}))).toEqual({
            title: 'Team',
            avatarUri: 'https://cdn/group.png',
            userId: null,
        });
    });

    it('falls back to a neutral label for an untitled group', () => {
        expect(getChatDisplay(preview({ title: null })).title).toBe(
            'Unnamed group',
        );
        expect(getChatDisplay(preview({ title: '   ' })).title).toBe(
            'Unnamed group',
        );
    });

    it('uses the peer name and avatar for a private chat', () => {
        const chat = preview({
            type: 'private',
            title: null,
            avatarUrls: [],
            peer: {
                id: 7,
                name: 'Sara',
                username: 'sara',
                avatars: ['uploads/sara.png'],
                isOnline: true,
                lastSeen: null,
            },
        });
        expect(getChatDisplay(chat)).toEqual({
            title: 'Sara',
            avatarUri: 'uploads/sara.png',
            userId: 7,
        });
    });

    it('keeps a usable display when a private chat has no peer', () => {
        const chat = preview({
            type: 'private',
            title: null,
            avatarUrls: [],
        });
        expect(getChatDisplay(chat)).toEqual({
            title: 'Private chat',
            avatarUri: null,
            userId: null,
        });
    });

    it('treats an unknown/missing type as a group', () => {
        const chat = preview({ type: undefined as never, title: 'Legacy' });
        expect(getChatDisplay(chat).title).toBe('Legacy');
    });
});
