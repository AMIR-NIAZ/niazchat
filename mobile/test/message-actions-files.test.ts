/**
 * Plain-TS unit tests for message action rules and document helpers.
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node","types":["node"]}' mobile/test/message-actions-files.test.ts
 */
import { getMessageActions } from '../src/features/messages/message-actions';
import type {
    ChatMessage,
    AttachmentView,
} from '../src/features/messages/messages-model';
import {
    extensionForMime,
    fileTypeLabel,
    mimeForFileName,
    sanitizeFileName,
    utiForFileName,
} from '../src/features/attachments/file-name';
import { selectFileCacheEvictions } from '../src/features/attachments/file-cache-policy';
import {
    NoViewerAppError,
    selectOpenStrategy,
} from '../src/features/attachments/file-open-policy';

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
    if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

function assertTrue(value: boolean, label: string): void {
    if (!value) throw new Error(label);
}

function attachment(
    kind: AttachmentView['kind'],
    over: Partial<AttachmentView> = {},
): AttachmentView {
    return {
        key: `a-${kind}`,
        id: 9,
        name: kind === 'voice' ? 'voice.m4a' : `${kind}.pdf`,
        mimeType:
            kind === 'voice'
                ? 'audio/mp4'
                : kind === 'image'
                  ? 'image/jpeg'
                  : 'application/pdf',
        size: 10,
        kind,
        status: 'uploaded',
        ...over,
    };
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
    return {
        key: '200',
        id: 200,
        type: 'text',
        content: 'hello',
        createdAtIso: '2026-01-01T00:00:00.000Z',
        isEdited: false,
        isDeleted: false,
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
        replyTo: null,
        replyToId: null,
        status: 'sent',
        pendingContent: null,
        ...over,
    };
}

const ctx = { currentUserId: 1, canDeleteOthers: false };

test('own text offers reply/forward/select/edit/delete', () => {
    const actions = getMessageActions(message(), ctx);
    assertEqual(actions, {
        reply: true,
        forward: true,
        select: true,
        edit: true,
        editLabel: 'Edit message',
        delete: true,
        deleteOthers: false,
        share: false,
    });
});

test('own photo without text has Delete but no Edit', () => {
    const actions = getMessageActions(
        message({ content: '', attachments: [attachment('image')] }),
        ctx,
    );
    assertEqual(actions.edit, false);
    assertEqual(actions.editLabel, null);
    assertEqual(actions.delete, true);
});

test('own photo with caption edits the caption', () => {
    const actions = getMessageActions(
        message({ content: 'caption', attachments: [attachment('image')] }),
        ctx,
    );
    assertEqual(actions.edit, true);
    assertEqual(actions.editLabel, 'Edit caption');
});

test('own video follows caption/Edit rules and Delete works', () => {
    const noCaption = getMessageActions(
        message({ content: null, attachments: [attachment('video')] }),
        ctx,
    );
    assertEqual(noCaption.edit, false);
    assertEqual(noCaption.delete, true);
    const caption = getMessageActions(
        message({ content: 'clip', attachments: [attachment('video')] }),
        ctx,
    );
    assertEqual(caption.editLabel, 'Edit caption');
});

test('own voice cannot be edited but can be deleted', () => {
    const actions = getMessageActions(
        message({
            type: 'voice',
            content: '',
            attachments: [attachment('voice')],
        }),
        ctx,
    );
    assertEqual(actions.edit, false);
    assertEqual(actions.delete, true);
    assertEqual(actions.share, false);
});

test('own document with caption has Edit caption and Share', () => {
    const actions = getMessageActions(
        message({ content: 'docs', attachments: [attachment('file')] }),
        ctx,
    );
    assertEqual(actions.edit, true);
    assertEqual(actions.editLabel, 'Edit caption');
    assertEqual(actions.share, true);
});

test('own attachment-only document has Share but no Edit', () => {
    const actions = getMessageActions(
        message({ content: '', attachments: [attachment('file')] }),
        ctx,
    );
    assertEqual(actions.edit, false);
    assertEqual(actions.share, true);
    assertEqual(actions.delete, true);
});

test('own mixed photo+document caption uses Edit caption', () => {
    const actions = getMessageActions(
        message({
            content: 'mixed',
            attachments: [attachment('image'), attachment('file')],
        }),
        ctx,
    );
    assertEqual(actions.editLabel, 'Edit caption');
    assertEqual(actions.share, true);
});

test('own forwarded text cannot be edited but keeps Delete', () => {
    const actions = getMessageActions(
        message({ forwardedFrom: { userId: 7, name: 'Original' } }),
        ctx,
    );
    assertEqual(actions.edit, false);
    assertEqual(actions.forward, true);
    assertEqual(actions.delete, true);
});

test('pending/failed local messages get no server actions', () => {
    const pending = getMessageActions(
        message({ id: null, status: 'pending', content: 'x' }),
        ctx,
    );
    const failed = getMessageActions(
        message({ id: null, status: 'failed', content: 'x' }),
        ctx,
    );
    for (const actions of [pending, failed]) {
        assertTrue(
            Object.values(actions).every((value) => !value),
            'no actions',
        );
    }
});

test("others' messages have no Edit/Delete for regular members", () => {
    const actions = getMessageActions(message({ senderId: 2 }), ctx);
    assertEqual(actions.edit, false);
    assertEqual(actions.delete, false);
    assertEqual(actions.reply, true);
    assertEqual(actions.forward, true);
});

test('group owner can delete another member message, with the owner label', () => {
    const actions = getMessageActions(message({ senderId: 2 }), {
        currentUserId: 1,
        canDeleteOthers: true,
    });
    assertEqual(actions.delete, true);
    assertEqual(actions.deleteOthers, true);
    assertEqual(actions.edit, false);
});

test('sanitizer strips traversal and control characters', () => {
    assertEqual(sanitizeFileName('../../etc/passwd', 12), 'passwd');
    assertEqual(
        sanitizeFileName('..\\..\\bad\u0000name\u0007.pdf', 12),
        'badname.pdf',
    );
    assertEqual(
        sanitizeFileName('../../', 12, 'application/pdf'),
        'file-12.pdf',
    );
});

test('sanitizer keeps Persian names and the extension', () => {
    assertEqual(sanitizeFileName('گزارش مالی.pdf', 12), 'گزارش مالی.pdf');
});

test('sanitizer caps long names at 100 while keeping the extension', () => {
    const name = sanitizeFileName(`${'x'.repeat(300)}.docx`, 12);
    assertEqual(name.length, 100);
    assertTrue(name.endsWith('.docx'), 'extension kept');
});

test('sanitizer adds an extension from MIME and falls back to file-id', () => {
    assertEqual(sanitizeFileName('', 5, 'application/pdf'), 'file-5.pdf');
    assertEqual(sanitizeFileName('report', 5, 'application/pdf'), 'report.pdf');
    assertEqual(extensionForMime('application/zip'), 'zip');
});

test('cache eviction deletes oldest first and honors both caps', () => {
    const files = [
        { path: 'old', size: 60, modifiedMs: 1 },
        { path: 'middle', size: 60, modifiedMs: 2 },
        { path: 'new', size: 60, modifiedMs: 3 },
    ];
    assertEqual(selectFileCacheEvictions(files, 3, 100), ['old', 'middle']);
    assertEqual(selectFileCacheEvictions(files, 2, 1000), ['old']);
    assertEqual(selectFileCacheEvictions(files, 3, 1000), []);
});

test('open strategy uses Android VIEW except for blocklisted files', () => {
    assertEqual(selectOpenStrategy('android', 'report.pdf'), {
        strategy: 'android-view',
        reason: 'android',
    });
    assertEqual(selectOpenStrategy('ios', 'report.pdf'), {
        strategy: 'share',
        reason: 'ios',
    });
    assertEqual(selectOpenStrategy('android', 'setup.apk'), {
        strategy: 'share',
        reason: 'blocked',
    });
});

test('no-app error is explicit and UTI is available for iOS sharing', () => {
    assertEqual(
        new NoViewerAppError().message,
        'No app found to open this file',
    );
    assertEqual(utiForFileName('report.pdf'), 'com.adobe.pdf');
    assertEqual(utiForFileName('unknown.xyz'), undefined);
});

test('row labels and MIME fallback derive from extension', () => {
    assertEqual(fileTypeLabel('a.pdf', 'application/pdf'), 'PDF');
    assertEqual(fileTypeLabel('a.docx', 'application/octet-stream'), 'DOCX');
    assertEqual(fileTypeLabel('a.xlsx', 'application/octet-stream'), 'XLSX');
    assertEqual(fileTypeLabel('a.zip', 'application/zip'), 'ZIP');
    assertEqual(fileTypeLabel('a.txt', 'text/plain'), 'TXT');
    assertEqual(
        mimeForFileName('a.pdf', 'application/octet-stream'),
        'application/pdf',
    );
    assertEqual(
        mimeForFileName('a.docx', ''),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
});

if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    const nodeProcess = (
        globalThis as {
            process?: { exitCode?: number };
        }
    ).process;
    if (nodeProcess !== undefined) nodeProcess.exitCode = 1;
} else {
    console.log('All message-action/document tests passed');
}
