function assertEqual<T>(actual: T, expected: T, label = ''): void {
    if (actual !== expected) {
        throw new Error(
            `${label || 'assertEqual'}: ${String(actual)} !== ${String(expected)}`,
        );
    }
}

function assertDeepEqual(actual: unknown, expected: unknown, label = ''): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `${label || 'assertDeepEqual'}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
        );
    }
}

function assertMatch(value: string, pattern: RegExp): void {
    if (!pattern.test(value)) {
        throw new Error(`${value} does not match ${String(pattern)}`);
    }
}
import {
    MAX_FORWARD_MESSAGES,
    MAX_FORWARD_TARGETS,
    chatForwardLabel,
    failedTargetIds,
    filterForwardChats,
    forwardRequestId,
    isForwardable,
    mergeForwardResults,
    pruneForwardSelection,
    selectedMessageIds,
    successfulTargetCount,
    toggleForwardSelection,
    toggleTarget,
} from '../src/features/messages/forward-helpers';
import { mergeMessages } from '../src/features/messages/messages-mapper';
import { toChatMessage } from '../src/features/messages/messages-mapper';
import type { ChatMessage } from '../src/features/messages/messages-model';
import type { ChatPreview } from '../src/features/chats/chats-model';
import type { MessageDto } from '../src/core/api/dto/message.dto';

function message(
    id: number | null,
    over: Partial<ChatMessage> = {},
): ChatMessage {
    return {
        key: id === null ? 'pending-1' : String(id),
        id,
        type: 'text',
        content: `m${id ?? 'p'}`,
        createdAtIso: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
        senderId: 1,
        senderName: 'Ali',
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachments: [],
        attachmentsCount: 0,
        clientMessageId: null,
        forwardedFrom: null,
        replyTo: null,
        replyToId: null,
        status: id === null ? 'pending' : 'sent',
        pendingContent: '',
        ...over,
    };
}

function chat(
    id: number,
    title: string | null,
    over: Partial<ChatPreview> = {},
): ChatPreview {
    return {
        id,
        type: title === null ? 'private' : 'groupe',
        title,
        isBan: false,
        avatarUrls: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastMessage: null,
        unreadCount: 0,
        ...over,
    };
}

let passed = 0;
function test(name: string, run: () => void): void {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
}

test('selection ignores pending and caps at 20', () => {
    let selected = new Set<number>();
    const pending = toggleForwardSelection(selected, message(null));
    assertEqual(pending.selected.size, 0);
    assertEqual(isForwardable(message(null)), false);
    for (let id = 1; id <= MAX_FORWARD_MESSAGES; id += 1) {
        selected = toggleForwardSelection(selected, message(id)).selected;
    }
    assertEqual(selected.size, MAX_FORWARD_MESSAGES);
    const overflow = toggleForwardSelection(selected, message(21));
    assertEqual(overflow.limitReached, true);
    assertEqual(overflow.selected.size, MAX_FORWARD_MESSAGES);
    assertEqual(selectedMessageIds(overflow.selected).length, 20);
});

test('selection is pruned when a selected message disappears', () => {
    const pruned = pruneForwardSelection(new Set([1, 2, 3]), [
        message(1),
        message(3),
        message(2, { isDeleted: true }),
    ]);
    assertDeepEqual([...pruned], [1, 3]);
});

test('picker shows recent order, filters by title and keeps private label', () => {
    const chats = [chat(2, 'Team'), chat(1, null)];
    assertDeepEqual(
        filterForwardChats(chats, 'tea').map((row) => row.id),
        [2],
    );
    assertEqual(chatForwardLabel(chats[1] as ChatPreview), 'Private chat');
    assertDeepEqual(filterForwardChats(chats, ''), chats);
});

test('targets cap at 5 and can be removed', () => {
    let selected = new Set<number>();
    for (let id = 1; id <= MAX_FORWARD_TARGETS; id += 1) {
        selected = toggleTarget(selected, id).selected;
    }
    assertEqual(toggleTarget(selected, 6).limitReached, true);
    selected = toggleTarget(selected, 2).selected;
    assertEqual(selected.has(2), false);
});

test('partial results merge and report only failures', () => {
    const first = {
        results: [
            { chatId: 1, ok: true as const, messageIds: [10] },
            { chatId: 2, ok: false as const, message: 'banned' },
        ],
    };
    assertDeepEqual(failedTargetIds(first), [2]);
    assertEqual(successfulTargetCount(first), 1);
    const merged = mergeForwardResults(first, {
        results: [{ chatId: 2, ok: true, messageIds: [11] }],
    });
    assertEqual(successfulTargetCount(merged), 2);
    assertDeepEqual(failedTargetIds(merged), []);
});

test('request ids are valid and unique enough', () => {
    const a = forwardRequestId();
    const b = forwardRequestId();
    assertMatch(a, /^[A-Za-z0-9_-]{8,64}$/);
    if (a === b) throw new Error('request ids must differ');
});

test('toChatMessage maps forwarded origin ids to numbers', () => {
    const dto = {
        id: 9,
        content: 'hello',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
        typeId: 1,
        type: { id: 1, name: 'text' },
        chatId: 4,
        senderId: 2,
        sender: { id: 2, name: 'B' },
        replyToId: null,
        replyTo: null,
        forwardedFrom: { userId: '7' as unknown as number, name: 'Ali' },
        attachments: [],
    } as unknown as MessageDto;
    const mapped = toChatMessage(dto);
    assertDeepEqual(mapped.forwardedFrom, { userId: 7, name: 'Ali' });
});

test('mergeMessages keeps forwardedFrom on a new and an existing echo', () => {
    const forwarded = message(10, {
        forwardedFrom: { userId: 7, name: 'Ali' },
    });
    const merged = mergeMessages([], [forwarded], 1);
    assertDeepEqual(merged[0]?.forwardedFrom, { userId: 7, name: 'Ali' });

    const refreshed = { ...forwarded, content: 'edited elsewhere' };
    const updated = mergeMessages(merged, [refreshed], 1);
    assertDeepEqual(updated[0]?.forwardedFrom, { userId: 7, name: 'Ali' });
    assertEqual(updated[0]?.content, 'edited elsewhere');
});

console.log(`All ${passed} forward helper tests passed`);
