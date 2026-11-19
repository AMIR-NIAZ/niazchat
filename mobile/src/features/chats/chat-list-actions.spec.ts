// The icon package pulls in react-native-svg, which needs the RN JSX
// transform; this Node test only cares about the action rows.
jest.mock(
    'lucide-react-native',
    () => new Proxy({}, { get: () => () => null }),
);

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
            type: 'text',
            service: null,
            senderName: 'Sara',
            senderId: 4,
            createdAt: '2026-01-02T10:00:00.000Z',
            attachmentCount: 0,
            firstAttachmentKind: null,
            firstAttachmentDuration: null,
            firstAttachmentName: null,
            firstAttachmentTitle: null,
        },
        unreadCount: 2,
        ...overrides,
    };
}

function privateChat(overrides: Partial<ChatPreview> = {}): ChatPreview {
    return group({
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
        ...overrides,
    });
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
        const ids = getChatListActions(privateChat(), base).map(
            (action) => action.id,
        );
        expect(ids).toContain('view-profile');
        expect(ids).not.toContain('group-info');
        expect(ids).not.toContain('leave-group');
    });

    it('offers block, delete for me and delete for both on a private chat', () => {
        const ids = getChatListActions(privateChat(), base).map(
            (action) => action.id,
        );
        expect(ids).toContain('block-user');
        expect(ids).toContain('delete-for-me');
        expect(ids).toContain('delete-for-both');
        expect(ids).not.toContain('unblock-user');
    });

    it('offers unblock instead of block when the caller blocked the peer', () => {
        const actions = getChatListActions(
            privateChat({ blockedByMe: true, blockedMe: false }),
            base,
        );
        expect(actions.map((action) => action.id)).toContain('unblock-user');
        expect(actions.map((action) => action.id)).not.toContain('block-user');
        expect(
            actions.find((action) => action.id === 'unblock-user')?.label,
        ).toBe('Unblock user');
    });

    it('keeps block available when only the peer blocked the caller', () => {
        const ids = getChatListActions(
            privateChat({ blockedByMe: false, blockedMe: true }),
            base,
        ).map((action) => action.id);
        expect(ids).toContain('block-user');
        expect(ids).not.toContain('unblock-user');
    });

    it('does not offer view profile for a private chat without a peer', () => {
        const ids = getChatListActions(
            group({ type: 'private', title: null, peer: null }),
            base,
        ).map((action) => action.id);
        expect(ids).not.toContain('view-profile');
        // Delete rows do not need a loaded peer (the server derives it).
        expect(ids).toContain('delete-for-me');
        expect(ids).toContain('delete-for-both');
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

    it('marks both delete actions as destructive', () => {
        const actions = getChatListActions(privateChat(), base);
        expect(
            actions.find((action) => action.id === 'delete-for-me')
                ?.destructive,
        ).toBe(true);
        expect(
            actions.find((action) => action.id === 'delete-for-both')
                ?.destructive,
        ).toBe(true);
    });

    it('returns nothing for a closed menu', () => {
        expect(getChatListActions(null, base)).toEqual([]);
    });
});
