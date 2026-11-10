/**
 * App-side avatar helpers check (no React Native runtime needed).
 *
 *   node_modules/.bin/ts-node --transpile-only \
 *     -O '{"module":"commonjs","moduleResolution":"node","resolvePackageJsonExports":false,"esModuleInterop":true,"target":"ES2023"}' \
 *     scripts/avatar-ui-check.ts
 */
import {
    AVATAR_THUMB_SIZES,
    avatarThumbUrl,
    pickAvatarThumbSize,
} from '../mobile/src/core/config/env';
import { assignMessageRuns } from '../mobile/src/features/messages/message-runs';
import type { ChatMessage } from '../mobile/src/features/messages/messages-model';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`);
    if (!passed) {
        failures += 1;
        console.log(`      got:      ${JSON.stringify(actual)}`);
        console.log(`      expected: ${JSON.stringify(expected)}`);
    }
}

function message(
    id: number,
    senderId: number,
    iso: string,
    status: ChatMessage['status'] = 'sent',
): ChatMessage {
    return {
        key: String(id),
        id: status === 'sent' ? id : null,
        type: 'text',
        content: `m${id}`,
        createdAtIso: iso,
        isEdited: false,
        isDeleted: false,
        senderId,
        senderName: `user${senderId}`,
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachments: [],
        attachmentsCount: 0,
        clientMessageId: null,
        forwardedFrom: null,
        replyTo: null,
        replyToId: null,
        status,
        pendingContent: null,

        // New reaction fields
        reactions: [],
        myReaction: null,
        myReactionProvided: false,
    };
}

const day1 = '2026-01-01T10:00:00.000Z';
const day2 = '2026-01-02T10:00:00.000Z';

// ── thumbnail URLs ─────────────────────────────────────────────────────────
check('allowed sizes are 64/128/256', [...AVATAR_THUMB_SIZES], [64, 128, 256]);
check('32dp @2x asks for 64', pickAvatarThumbSize(32, 2), 64);
check('32dp @1x asks for 64', pickAvatarThumbSize(32, 1), 64);
check('40dp @2x asks for 128', pickAvatarThumbSize(40, 2), 128);
check('120dp @2x asks for 256 (cap)', pickAvatarThumbSize(120, 2), 256);
check('300dp @3x caps at 256', pickAvatarThumbSize(300, 3), 256);
check(
    'relative path → thumbnail route',
    avatarThumbUrl('uploads/avatars/a-b_c.png', 32, 1)?.endsWith(
        '/media/avatars/64/a-b_c.png',
    ),
    true,
);
check(
    'absolute uploads URL → thumbnail route',
    avatarThumbUrl('http://host:3000/uploads/avatars/a.png', 40, 2)?.endsWith(
        '/media/avatars/128/a.png',
    ),
    true,
);
check('empty path has no thumbnail', avatarThumbUrl('', 32), null);
check(
    'non-image path has no thumbnail',
    avatarThumbUrl('uploads/x.txt', 32),
    null,
);

// ── run grouping ───────────────────────────────────────────────────────────
const a1 = message(1, 2, day1);
const a2 = message(2, 2, day1);
const a3 = message(3, 2, day1);
const b1 = message(4, 3, day1);
const mine1 = message(5, 9, day1);

const grouped = assignMessageRuns([a1, a2, a3, b1, mine1], {
    isGroup: true,
    currentUserId: 9,
});
check(
    'run: name on first message only',
    grouped.map((row) => row.showSenderName),
    [true, false, false, true, false],
);
check(
    'run: avatar on last message only',
    grouped.map((row) => row.showAvatar),
    [false, false, true, true, false],
);

const live = assignMessageRuns([a1, a2, a3, message(6, 2, day1)], {
    isGroup: true,
    currentUserId: 9,
});
check(
    'live extend: avatar moves to the new last message',
    live.map((row) => row.showAvatar),
    [false, false, false, true],
);

const prepended = assignMessageRuns([message(7, 2, day2), a1, a2, a3], {
    isGroup: true,
    currentUserId: 9,
});
check(
    'prepend: new day breaks the run',
    prepended.map((row) => ({
        name: row.showSenderName,
        avatar: row.showAvatar,
        day: row.startsNewDay,
    })),
    [
        { name: true, avatar: true, day: false },
        { name: true, avatar: false, day: true },
        { name: false, avatar: false, day: false },
        { name: false, avatar: true, day: false },
    ],
);

const divider = assignMessageRuns([a1, a2, a3], {
    isGroup: true,
    currentUserId: 9,
    dividerMessageId: 2,
});
check(
    'unread divider splits the run (avatar closes each run)',
    divider.map((row) => ({
        name: row.showSenderName,
        avatar: row.showAvatar,
    })),
    [
        { name: true, avatar: true },
        { name: true, avatar: false },
        { name: false, avatar: true },
    ],
);

const privateChat = assignMessageRuns([a1, a2, b1], {
    isGroup: false,
    currentUserId: 9,
});
check(
    'private chat: no names or avatars',
    privateChat.map((row) => ({
        name: row.showSenderName,
        avatar: row.showAvatar,
    })),
    [
        { name: false, avatar: false },
        { name: false, avatar: false },
        { name: false, avatar: false },
    ],
);

const pending = assignMessageRuns([a1, message(8, 9, day1, 'pending')], {
    isGroup: true,
    currentUserId: 9,
});
check(
    'pending bubbles never show a name or avatar',
    pending.map((row) => ({
        name: row.showSenderName,
        avatar: row.showAvatar,
    })),
    [
        { name: true, avatar: true },
        { name: false, avatar: false },
    ],
);

if (failures > 0) {
    console.error(`\n${failures} avatar UI check(s) failed.`);
    process.exit(1);
}
console.log('\nAll avatar UI checks passed.');
