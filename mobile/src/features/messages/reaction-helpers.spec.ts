import type { ReactionSnapshotDto } from '../../core/api';
import {
    applyMyReaction,
    applyReactionUpdate,
    sortReactions,
} from './reaction-helpers';
import {
    mergeMessages,
    replaceMessage,
    toChatMessage,
} from './messages-mapper';
import type { ChatMessage } from './messages-model';
import { normalizeEmoji } from '../reactions';

function message(over: Partial<ChatMessage> = {}): ChatMessage {
    return {
        key: '10',
        id: 10,
        type: 'text',
        content: 'hello',
        createdAtIso: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
        senderId: 2,
        senderName: 'Sara',
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachments: [],
        attachmentsCount: 0,
        reactions: [{ emoji: '👍', count: 2 }],
        myReaction: '👍',
        myReactionProvided: true,
        clientMessageId: null,
        forwardedFrom: null,
        replyTo: null,
        replyToId: null,
        status: 'sent',
        pendingContent: null,
        ...over,
    };
}

function snapshot(
    over: Partial<ReactionSnapshotDto> = {},
): ReactionSnapshotDto {
    return {
        chatId: 1,
        messageId: 10,
        reactions: [{ emoji: '👍', count: 1 }],
        myReaction: null,
        actor: { userId: 3, emoji: '👍' },
        ...over,
    };
}

describe('normalizeEmoji', () => {
    it('strips the variation selector and whitespace', () => {
        expect(normalizeEmoji('❤️')).toBe('❤');
        expect(normalizeEmoji(' ❤️ ')).toBe('❤');
        expect(normalizeEmoji('👍')).toBe('👍');
    });
});

describe('sortReactions', () => {
    it('orders by count descending and keeps ties stable', () => {
        expect(
            sortReactions([
                { emoji: '😂', count: 1 },
                { emoji: '❤️', count: 3 },
                { emoji: '👍', count: 1 },
            ]),
        ).toEqual([
            { emoji: '❤️', count: 3 },
            { emoji: '😂', count: 1 },
            { emoji: '👍', count: 1 },
        ]);
    });
});

describe('applyReactionUpdate', () => {
    it("replaces counts while keeping another viewer's own reaction", () => {
        const result = applyReactionUpdate(
            [message({ myReaction: null })],
            snapshot({ myReaction: null }),
            9,
        )[0];
        expect(result?.reactions).toEqual([{ emoji: '👍', count: 1 }]);
        expect(result?.myReaction).toBeNull();
    });

    it('applies the personalized myReaction', () => {
        const result = applyReactionUpdate(
            [message()],
            snapshot({
                reactions: [
                    { emoji: '👍', count: 2 },
                    { emoji: '❤️', count: 1 },
                ],
                myReaction: '❤️',
                actor: { userId: 9, emoji: '❤️' },
            }),
            9,
        )[0];
        expect(result?.reactions).toEqual([
            { emoji: '👍', count: 2 },
            { emoji: '❤️', count: 1 },
        ]);
        expect(result?.myReaction).toBe('❤️');
    });

    it('falls back to the actor emoji when the actor is me', () => {
        const result = applyReactionUpdate(
            [message({ myReaction: null })],
            {
                ...snapshot(),
                myReaction: undefined as unknown as string | null,
            },
            3,
        )[0];
        expect(result?.myReaction).toBe('👍');
    });

    it('ignores malformed payloads', () => {
        const current = [message()];
        expect(
            applyReactionUpdate(
                current,
                { ...snapshot(), reactions: null as never },
                3,
            ),
        ).toBe(current);
    });
});

describe('applyMyReaction', () => {
    it('adds a different emoji optimistically and replaces the old one', () => {
        const result = applyMyReaction(
            [message({ reactions: [{ emoji: '👍', count: 2 }] })],
            10,
            '❤️',
        )[0];
        expect(result?.reactions).toEqual([
            { emoji: '👍', count: 1 },
            { emoji: '❤️', count: 1 },
        ]);
        expect(result?.myReaction).toBe('❤️');
    });

    it('toggles the same emoji off', () => {
        const result = applyMyReaction([message()], 10, '👍')[0];
        expect(result?.reactions).toEqual([{ emoji: '👍', count: 1 }]);
        expect(result?.myReaction).toBeNull();
    });
});

describe('message merges keep reaction state', () => {
    const echo = toChatMessage({
        id: 10,
        content: 'hello',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
        typeId: 1,
        type: {
            id: 1,
            name: 'text',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        },
        chatId: 1,
        senderId: 2,
        sender: {
            id: 2,
            name: 'Sara',
            username: null,
            avatars: [],
        } as never,
        replyToId: null,
        replyTo: null,
        attachments: [],
        reactions: [{ emoji: '👍', count: 2 }],
    } as never);
    it('keeps myReaction when an echo omits it', () => {
        const current = message();
        const merged = mergeMessages([current], [echo], 1)[0];
        expect(merged?.myReaction).toBe('👍');
        expect(merged?.reactions).toEqual([{ emoji: '👍', count: 2 }]);
    });

    it('keeps myReaction when an edit echo omits it', () => {
        const merged = replaceMessage([message()], echo)[0];
        expect(merged?.myReaction).toBe('👍');
    });
});
