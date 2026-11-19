import type { AttachmentView, ChatMessage } from './messages-model';
import {
    applyPinnedState,
    pinnedPreviewText,
    removePinnedMessage,
    replacePinnedMessage,
    upsertPinnedMessage,
} from './pinned-messages';

function message(id: number, over: Partial<ChatMessage> = {}): ChatMessage {
    return {
        key: String(id),
        id,
        type: 'text',
        content: `m${id}`,
        createdAtIso: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
        isPinned: false,
        pinnedAtIso: null,
        senderId: 1,
        senderName: 'Ali',
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachments: [],
        attachmentsCount: 0,
        reactions: [],
        myReaction: null,
        myReactionProvided: false,
        clientMessageId: null,
        forwardedFrom: null,
        service: null,
        replyTo: null,
        replyToId: null,
        status: 'sent',
        pendingContent: null,
        ...over,
    };
}

describe('pinned message helpers', () => {
    it('dedupes a pin echo into exactly one banner entry', () => {
        const first = upsertPinnedMessage([], message(2, { isPinned: true }));
        const second = upsertPinnedMessage(
            first,
            message(2, { isPinned: true }),
        );

        expect(second).toHaveLength(1);
        expect(second[0]?.id).toBe(2);
    });

    it('keeps the newest pin first', () => {
        const older = message(1, { isPinned: true });
        const newer = message(2, { isPinned: true });

        expect(
            upsertPinnedMessage([older], newer).map((item) => item.id),
        ).toEqual([2, 1]);
    });

    it('removes an unpinned/deleted message and tolerates unknown ids', () => {
        const pinned = [message(2, { isPinned: true })];
        expect(removePinnedMessage(pinned, 2)).toEqual([]);
        expect(removePinnedMessage(pinned, '999')).toBe(pinned);
        expect(removePinnedMessage(pinned, null)).toBe(pinned);
    });

    it('applies pin state without touching unrelated messages', () => {
        const untouched = message(1);
        const target = message(2);
        const next = applyPinnedState(
            [untouched, target],
            2,
            true,
            '2026-01-01T00:00:00.000Z',
        );

        expect(next[0]).toBe(untouched);
        expect(next[1]).toMatchObject({
            isPinned: true,
            pinnedAtIso: '2026-01-01T00:00:00.000Z',
        });
    });

    it('returns the same array for a duplicate event', () => {
        const current = [message(2, { isPinned: true, pinnedAtIso: 'x' })];
        expect(applyPinnedState(current, 2, true, 'x')).toBe(current);
    });

    it('refreshes an edited pinned preview in place', () => {
        const current = [message(2, { isPinned: true })];
        const next = replacePinnedMessage(
            current,
            message(2, { isPinned: true, content: 'edited' }),
        );

        expect(next[0]?.content).toBe('edited');
    });

    it('builds a text or attachment banner preview', () => {
        expect(pinnedPreviewText(message(1, { content: 'hello' }))).toBe(
            'hello',
        );

        const photo: AttachmentView = {
            key: 'a-1',
            id: 1,
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 10,
            kind: 'image',
            status: 'uploaded',
        };
        expect(
            pinnedPreviewText(
                message(2, { content: null, attachments: [photo] }),
            ),
        ).toBe('Photo');
    });
});
