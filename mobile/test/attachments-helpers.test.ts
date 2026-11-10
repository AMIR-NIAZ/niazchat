/**
 * Plain-TS unit tests for the attachment helpers (run with ts-node; no test
 * framework is installed in the mobile package).
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' mobile/test/attachments-helpers.test.ts
 */
import {
    mergeMessages,
    toPendingChatMessage,
} from '../src/features/messages/messages-mapper';
import { uploadFailureReason } from '../src/features/attachments/attachment-upload';
import type {
    AttachmentView,
    ChatMessage,
} from '../src/features/messages/messages-model';
import { validateNewAttachments } from '../src/features/attachments/validation';
import type { LocalAttachment } from '../src/features/attachments/validation';
import { attachmentPreviewLabel } from '../src/features/attachments/attachment-labels';
import { chatPreviewText } from '../src/features/chats/chats-mapper';
import {
    MAX_ATTACHMENT_FILE_SIZE,
    MAX_ATTACHMENTS_PER_MESSAGE,
} from '../src/features/attachments/constants';

let failures = 0;

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}`);
        console.error(error instanceof Error ? error.stack : error);
    }
}

function assertEqual<T>(actual: T, expected: T, label = ''): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${label} expected ${e}, got ${a}`);
    }
}

function assertTrue(value: boolean, label: string): void {
    if (!value) throw new Error(label);
}

function photo(index: number): AttachmentView {
    return {
        key: `a-${index}`,
        id: index,
        name: `photo-${index}.jpg`,
        mimeType: 'image/jpeg',
        size: 100,
        kind: 'image',
        status: 'uploaded',
    };
}

function confirmed(id: number, over: Partial<ChatMessage> = {}): ChatMessage {
    return {
        key: String(id),
        id,
        type: 'text',
        content: '',
        createdAtIso: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
        senderId: 1,
        senderName: 'Ali',
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachments: [photo(id)],
        attachmentsCount: 1,
        clientMessageId: null,
        forwardedFrom: null,
        replyTo: null,
        replyToId: null,
        status: 'sent',
        pendingContent: '',
        ...over,
    };
}

function pending(
    key: string,
    clientMessageId: string | null,
    over: Partial<ChatMessage> = {},
): ChatMessage {
    return {
        key: `pending-${key}`,
        id: null,
        type: 'text',
        content: '',
        createdAtIso: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
        senderId: 1,
        senderName: '',
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachments: [photo(99)],
        attachmentsCount: 1,
        clientMessageId,
        forwardedFrom: null,
        replyTo: null,
        replyToId: null,
        status: 'pending',
        pendingContent: '',
        ...over,
    };
}

test('echo with clientMessageId and empty content consumes the pending bubble', () => {
    const local = pending('1', 'c-1');
    const merged = mergeMessages(
        [local],
        [confirmed(50, { clientMessageId: 'c-1' })],
        1,
    );
    assertEqual(merged.length, 1);
    assertEqual(merged[0]?.id, 50);
    assertEqual(
        merged.filter((message) => message.id === null).length,
        0,
        'no pending left',
    );
});

test('two identical photos in a row match by clientMessageId, not content', () => {
    const first = pending('1', 'c-1');
    const second = pending('2', 'c-2');
    let list = mergeMessages(
        [first, second],
        [confirmed(50, { clientMessageId: 'c-2' })],
        1,
    );
    // The second pending bubble (c-2) is the one consumed.
    assertEqual(list.length, 2);
    assertEqual(
        list.filter((message) => message.id === null).map((m) => m.key),
        ['pending-1'],
    );

    list = mergeMessages(list, [confirmed(51, { clientMessageId: 'c-1' })], 1);
    assertEqual(list.length, 2);
    assertEqual(
        list.map((message) => message.id),
        [50, 51],
    );
});

test('echo arriving before the ack does not duplicate or consume twice', () => {
    const local = pending('1', 'c-1');
    let list = mergeMessages(
        [local],
        [confirmed(50, { clientMessageId: 'c-1' })],
        1,
    );
    // Ack re-delivers the same message id, with the same client id.
    list = mergeMessages(list, [confirmed(50, { clientMessageId: 'c-1' })], 1);
    assertEqual(list.length, 1);
    assertEqual(list[0]?.id, 50);
});

test('failed bubbles are matched too', () => {
    const local = pending('1', 'c-1', { status: 'failed' });
    const merged = mergeMessages(
        [local],
        [confirmed(50, { clientMessageId: 'c-1' })],
        1,
    );
    assertEqual(merged.length, 1);
    assertEqual(merged[0]?.id, 50);
});

test('legacy messages without clientMessageId still match by sender + content', () => {
    const local = pending('1', null, {
        content: 'hello',
        pendingContent: 'hello',
        attachments: [],
        attachmentsCount: 0,
    });
    const merged = mergeMessages(
        [local],
        [
            confirmed(50, {
                content: 'hello',
                attachments: [],
                clientMessageId: null,
            }),
        ],
        1,
    );
    assertEqual(merged.length, 1);
    assertEqual(merged[0]?.id, 50);
});

test('an echo never consumes a pending bubble owned by another client id', () => {
    const local = pending('1', 'c-1');
    const merged = mergeMessages(
        [local],
        [confirmed(50, { clientMessageId: 'c-other' })],
        1,
    );
    assertEqual(merged.length, 2);
    assertEqual(merged.filter((message) => message.id === null).length, 1);
});

function localFile(over: Partial<LocalAttachment> = {}): LocalAttachment {
    return {
        localKey: 'l1',
        uri: 'file:///tmp/a.pdf',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: 100,
        kind: 'file',
        ...over,
    };
}

test('validation rejects too many files', () => {
    const existing = Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE - 1 },
        () => localFile(),
    );
    const result = validateNewAttachments(existing, [localFile(), localFile()]);
    assertTrue(result.error !== null, 'expected an error');
    assertEqual(result.accepted.length, 0);
});

test('validation rejects a file over 20 MB', () => {
    const result = validateNewAttachments(
        [],
        [localFile({ size: MAX_ATTACHMENT_FILE_SIZE + 1 })],
    );
    assertTrue(result.error?.includes('20 MB') === true, 'size message');
});

test('validation rejects blocked extensions', () => {
    const result = validateNewAttachments(
        [],
        [
            localFile({
                name: 'setup.exe',
                mimeType: 'application/octet-stream',
            }),
        ],
    );
    assertTrue(result.error?.includes('cannot be sent') === true, 'blocked');
});

test('validation accepts a valid selection', () => {
    const result = validateNewAttachments([], [localFile(), localFile()]);
    assertEqual(result.error, null);
    assertEqual(result.accepted.length, 2);
});

test('attachment preview labels cover photo, multiple photos and files', () => {
    assertEqual(attachmentPreviewLabel(1, 'image'), '📷 Photo');
    assertEqual(attachmentPreviewLabel(3, 'image'), '📷 3 photos');
    assertEqual(
        attachmentPreviewLabel(1, 'file', 'report.pdf'),
        '📎 report.pdf',
    );
    assertEqual(attachmentPreviewLabel(2, 'file', 'a.pdf'), '📎 2 files');
    assertEqual(attachmentPreviewLabel(0, null), '');
});

test('chat list preview derives Photo / file name from metadata', () => {
    assertEqual(
        chatPreviewText({
            id: 1,
            content: '',
            senderId: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            senderName: null,
            attachmentCount: 3,
            firstAttachmentKind: 'image',
            firstAttachmentDuration: null,
            firstAttachmentName: null,
        }),
        '📷 3 photos',
    );
    assertEqual(
        chatPreviewText({
            id: 1,
            content: '',
            senderId: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            senderName: null,
            attachmentCount: 1,
            firstAttachmentKind: 'file',
            firstAttachmentDuration: null,
            firstAttachmentName: 'report.pdf',
        }),
        '📎 report.pdf',
    );
    assertEqual(
        chatPreviewText({
            id: 1,
            content: 'hello',
            senderId: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            senderName: null,
            attachmentCount: 0,
            firstAttachmentKind: null,
            firstAttachmentDuration: null,
            firstAttachmentName: null,
        }),
        'hello',
    );
});

test('upload failures map to short, specific reasons', () => {
    assertEqual(uploadFailureReason(413, null), 'File too large');
    assertEqual(uploadFailureReason(401, null), 'Session expired');
    assertEqual(
        uploadFailureReason(403, null),
        "You can't upload to this chat",
    );
    assertEqual(
        uploadFailureReason(404, null),
        "You can't upload to this chat",
    );
    assertEqual(uploadFailureReason(0, null), 'No connection');
    assertEqual(
        uploadFailureReason(400, {
            message: 'file content is not a valid image',
        }),
        'file content is not a valid image',
    );
    assertEqual(
        uploadFailureReason(400, { message: ['file is required', 'bad type'] }),
        'file is required, bad type',
    );
    assertEqual(uploadFailureReason(500, null), 'Upload failed (500)');
    assertEqual(uploadFailureReason(429, null), 'Too many uploads. Try again.');
});

test('pending bubble uses its key verbatim (no pending-pending prefix)', () => {
    const pending = toPendingChatMessage(
        'p-abc-1-x',
        '',
        1,
        null,
        [photo(1)],
        'c-abc-1-x',
    );
    assertEqual(pending.key, 'p-abc-1-x');
    assertTrue(!pending.key.includes('pending-pending'), 'double prefix');
});

interface RequireWithCache {
    (id: string): unknown;
    resolve(id: string): string;
    cache: Record<string, unknown>;
}

const nodeRequire = require as unknown as RequireWithCache;

test('pending and client ids stay unique across 6,000 remounts', () => {
    const modulePath = nodeRequire.resolve(
        '../src/features/messages/local-keys',
    );
    const pending = new Set<string>();
    const clients = new Set<string>();
    const selections = new Set<string>();

    for (let round = 0; round < 6; round += 1) {
        // Simulate an app/Fast-Refresh remount: a fresh module instance with a
        // reset counter must still never emit a key seen before.
        delete nodeRequire.cache[modulePath];
        const keys = nodeRequire(modulePath) as {
            nextPendingMessageKey: () => string;
            nextClientMessageId: () => string;
            nextSelectionKey: () => string;
        };
        for (let index = 0; index < 1000; index += 1) {
            const messageKey = keys.nextPendingMessageKey();
            const clientId = keys.nextClientMessageId();
            const selectionKey = keys.nextSelectionKey();
            assertTrue(
                !pending.has(messageKey),
                `duplicate message key ${messageKey}`,
            );
            assertTrue(
                !clients.has(clientId),
                `duplicate client id ${clientId}`,
            );
            assertTrue(
                !selections.has(selectionKey),
                `duplicate selection key ${selectionKey}`,
            );
            pending.add(messageKey);
            clients.add(clientId);
            selections.add(selectionKey);
        }
    }

    assertEqual(pending.size, 6000);
    assertEqual(clients.size, 6000);
    assertEqual(selections.size, 6000);
});

if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    const nodeProcess = (
        globalThis as {
            process?: { exitCode?: number };
        }
    ).process;
    if (nodeProcess !== undefined) {
        nodeProcess.exitCode = 1;
    }
} else {
    console.log('All attachment helper tests passed');
}
