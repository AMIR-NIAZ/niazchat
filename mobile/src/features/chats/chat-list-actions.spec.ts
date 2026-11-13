import { getChatListActions } from './chat-list-actions';
import type { ChatPreview } from './chats-model';

function group(overrides: Partial<ChatPreview> = {}): ChatPreview {
    return {
        id: 7,
        type: 'groupe',
        title: 'Design',
        peer: null,
        isBan: false,
        avatarUrls: [],
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
        lastMessage: {
            id: 99,
            content: 'hello',
            senderName: 'Sara',
            senderId: 4,
            createdAt: '2026-01-02T10:00:00.000Z',
            attachmentCount: 0,
            firstAttachmentKind: null,
            firstAttachmentDuration: null,
            firstAttachmentName: null,
        },
        unreadCount: 2,
        ...overrides,
    };
}

const base = { markSeenAvailable: true, pinned: false, role: 'user' as const };

describe('getChatListActions', () => {
    it('offers pin, mark as read and group info for an unread group', () => {
        expect(
            getChatListActions(group(), base).map((action) => action.id),
        ).toEqual(['pin', 'mark-read', 'group-info', 'leave-group']);
    });

    it('labels the pin row as unpin when pinned', () => {
        const actions = getChatListActions(group(), {
            ...base,
            pinned: true,
        });
        expect(actions[0]?.id).toBe('unpin');
        expect(actions[0]?.label).toBe('Unpin chat');
    });

    it('omits mark as read without unread messages', () => {
        const ids = getChatListActions(group({ unreadCount: 0 }), base).map(
            (action) => action.id,
        );
        expect(ids).not.toContain('mark-read');
    });

    it('omits mark as read without a last message', () => {
        const ids = getChatListActions(group({ lastMessage: null }), base).map(
            (action) => action.id,
        );
        expect(ids).not.toContain('mark-read');
    });

    it('omits mark as read when the seen feature is unavailable', () => {
        const ids = getChatListActions(group(), {
            ...base,
            markSeenAvailable: false,
        }).map((action) => action.id);
        expect(ids).not.toContain('mark-read');
    });

    it('offers view profile for a private chat with a known peer', () => {
        const privateChat = group({
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
        });
        const ids = getChatListActions(privateChat, base).map(
            (action) => action.id,
        );
        expect(ids).toContain('view-profile');
        expect(ids).not.toContain('group-info');
        expect(ids).not.toContain('leave-group');
    });

    it('does not offer view profile for a private chat without a peer', () => {
        const ids = getChatListActions(
            group({ type: 'private', title: null, peer: null }),
            base,
        ).map((action) => action.id);
        expect(ids).not.toContain('view-profile');
    });

    it('never offers leave group to the owner', () => {
        const ids = getChatListActions(group(), {
            ...base,
            role: 'manager',
        }).map((action) => action.id);
        expect(ids).not.toContain('leave-group');
    });

    it('waits for the role before offering leave group', () => {
        const ids = getChatListActions(group(), {
            ...base,
            role: null,
        }).map((action) => action.id);
        expect(ids).not.toContain('leave-group');
        expect(ids).toContain('group-info');
    });

    it('marks leave group as destructive', () => {
        const leave = getChatListActions(group(), base).find(
            (action) => action.id === 'leave-group',
        );
        expect(leave?.destructive).toBe(true);
    });

    it('returns nothing for a closed menu', () => {
        expect(getChatListActions(null, base)).toEqual([]);
    });
});
