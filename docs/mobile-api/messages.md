# Messages

Sources: `src/modules/messages/gateways/message.gateway.ts`, `src/modules/messages/services/message.service.ts`, `dtos/createMessage.dto.ts`, `EditMessage.dto.ts`, `deleteMessage.dto.ts`.

**Important:** messages have **no REST endpoints at all** (`/src/modules/messages` contains no controllers). Everything goes through Socket.IO — see [websocket.md](./websocket.md).

## Client → server events

| Event             | Payload (`class-validator` on WS)                 | Purpose                                                                                             |
| ----------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sendMessage`     | `CreateMessageDto`                                | Send to a group chat or start a private chat                                                        |
| `editMessage`     | `EditMessageDto`                                  | Edit own message text/caption (not voice/forwarded/attachment-only)                                 |
| `deleteMessage`   | `deleteMessageDto`                                | Soft-delete own message                                                                             |
| `getMessages`     | `GetMessagesDto`: `{ chatId, beforeId?, limit? }` | Fetch one page of a chat's history (newest first; see [History / pagination](#history--pagination)) |
| `forwardMessages` | `ForwardMessagesDto`                              | Copy 1..20 messages to 1..5 chats (see [Forwarding](#forwarding))                                   |

### `CreateMessageDto` (`src/modules/messages/dtos/createMessage.dto.ts`)

```json
{
    "chatId": 42, // required if group chat; optional otherwise
    "userId": 7, // required for PV messages (receiver user id)
    "content": "text ≤5000", // optional when attachments are present (MaxLength(5000))
    "reply": 123, // optional number: MessageId being replied to
    "attachments": [12], // optional, 1..10 UNIQUE positive attachment ids (see attachments.md)
    "clientMessageId": "c_lz3k9f2", // optional 1..64 of A-Z a-z 0-9 _ -
    "type": "text" // optional, TypeMessageEnum — defaults to text
}
```

A message needs text **or** at least one attachment; otherwise it is rejected
(`message needs text or at least one attachment`). `clientMessageId` is echoed
on the room event and the ack but is **not persisted** (history omits it).

`sendChat` requires membership (`BadRequestException 'user not exit in chat'`). `sendPv` finds or creates a private Chat between the two users (`MessageService.sendPv`).

`type` values: `text` | `image` | `video` | `file` | `voice` | `ice`. Note: only `text` (`TextContentHandler`) is registered in the content-handler pool (`message.module.ts`) — for other types the `ContentResolverService` would throw `Unsupported message type`, **but it isn't actually invoked in the create flow**; the server treats them as text today.

### Validation failures (from the global WS `ValidationPipe`)

```json
/** ExceptionFilter format (useWsExceptionFilter in websocket.md) */
{ "message": ["chatId must be a number"], "status": 400 }
```

`sendMessage` without `chatId` or `userId` → `WsException('Bad Request Exception')` style throw.

## Server → client events (broadcast to room)

| Event                | Emitted to                     | Payload (raw `Message` entity + populated relations)                                    |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| `sendMessage:list`   | room `chat:<chatId>`           | full serialized Message (sender → `{ id, name, username, avatars }`, type, attachments) |
| `editMessage:list`   | room                           | updated message (`isEdited: true`)                                                      |
| `deleteMessage:list` | room                           | **just the number** `dto.messageId`                                                     |
| `getMessages`        | ack only                       | `{ messages, hasMore, nextCursor }` (ack data; desc by id within the page)              |
| `chatlist:updated`   | each member's `user:<id>` room | chat-list preview payload (see below)                                                   |

### `chatlist:updated` payload

```json
{
    "chatId": 42,
    "lastMessage": {
        "id": 999,
        "content": "hello",
        "senderId": 7,
        "createdAt": "...",
        "attachments": [
            {
                "id": 12,
                "originalName": "...",
                "mimeType": "...",
                "size": 12345,
                "kind": "image",
                "width": 1280,
                "height": 960
            }
        ]
    }
}
```

When `content` is empty the app derives the preview from the attachments:
`📷 Photo` / `📷 3 photos` / `🎬 Video` / `🎬 2 videos` /
`🎤 Voice message 0:23` / `📎 <file name>`.

### Voice messages

A voice message is exactly one attachment with `kind: "voice"` and empty text;
the server rejects any other combination (see attachments.md). The wire
attachment carries `duration` and `waveform` (64 integers `0..100`, or `null`).
The app downloads the file completely to its cache and plays it locally; the
download route serves the detected audio MIME inline.

### Actual `Message` shape (as serialized by gateway)

```ts
{
  id: number,
  content: string,          // null/'' for attachment-only messages
  createdAt, updatedAt,     // ISO strings
  isEdited: boolean,
  isDeleted: boolean,
  typeId: number,           // raw FK (`type` ids, NOT the enum name string)
  type: { id, name: 'text', createdAt, updatedAt },
  chatId: number,
  senderId: number,
  sender: {              // REDUCED projection (no phone/lastSeen/status/biografy)
    id: number,
    name: string,
    username: string | null,
    avatars: string[]    // at most the CURRENT photo: [path] or []
  },
  replyToId: number | null,
  forwardedFrom: {        // first forward origin; null for ordinary messages
    userId: number | null, // null when the original user no longer exists
    name: string           // snapshot taken at first forward time
  } | null,
  replyTo: {              // compact quoted preview, null when not a reply
    id: number,
    content: string | null, // ~200-char truncation; null when isDeleted
    senderId: number,
    senderName: string,
    type: string,
    attachmentsCount: number,
    attachmentKind: 'image' | 'video' | 'voice' | 'file' | null, // first attachment
    attachmentDuration: number | null, // duration of a voice/video first attachment
    isDeleted: boolean
  } | null,
  attachments: [{
     id: number, originalName: string, mimeType: string,
     size: number, kind: 'image' | 'video' | 'voice' | 'file',
     width?: number, height?: number,   // known for new images/videos
     duration?: number,                 // videos + voice
     hasPoster?: boolean,               // videos only
     waveform?: number[] | null,        // voice only: 64 bars 0..100
     createdAt: string
  }],
  // clientMessageId: string — ONLY on the send ack / sendMessage:list echo
}
```

(`getMessages`/`loadMessage` output above, from `MessageService.getPage` and `loadMessage`. Storage keys, paths (including `posterPath`), uploader ids and statuses are never serialized. `hasPoster` is derived from the private poster reference.)

## Forwarding

`forwardMessages` accepts:

```json
{
    "fromChatId": 42,
    "messageIds": [100, 101, 102],
    "toChatIds": [43, 44],
    "requestId": "fwd_m6x1k_ab12cd34"
}
```

- `messageIds`: 1..20 unique positive integers, sorted ascending by the server.
- `toChatIds`: 1..5 unique positive integers; the source chat is allowed.
- `requestId`: 8..64 chars of `A-Z a-z 0-9 _ -`.

Authorization is enforced per chat: the caller must be a member, not have the
`ban` role, and the chat must not have `isBan = true`. Source failure rejects
the whole request; a failing target returns `{ chatId, ok: false, message }`
without blocking other targets. The source must belong to `fromChatId` and not
be soft-deleted; a missing/foreign/deleted id rejects the whole selection.

```json
{
    "results": [
        { "chatId": 43, "ok": true, "messageIds": [200, 201, 202] },
        {
            "chatId": 44,
            "ok": false,
            "message": "You have been banned from the target chat"
        }
    ]
}
```

Each new message is owned by the forwarder, carries the copied text/type and
new attachment rows/files, and never carries `replyTo`. Its `forwardedFrom` is
the original sender snapshot; forwarding a forwarded message keeps the first
origin. The source chat id/name is never stored on the copies.

`requestId` is idempotent for 2 minutes per user: a replay returns the stored
result and creates/emits nothing again. At most 20 forward requests per user
per minute are allowed (`Too many forward requests. Try again in a minute.`).
Other errors include `You are not a member of the source chat`, `The source
chat has been banned`, and `An attachment is no longer available`.

## Reply rules

- `sendMessage.reply` is validated server-side: the original must exist in the **same chat** and have `isDeleted: false`, otherwise `BadRequestException 'reply message not found in this chat (or deleted)'`.
- Missing/non-numeric `reply` means "no reply" (normalized, not rejected).
- Reply-to-a-reply is allowed; only one preview level is serialized (`replyTo`).
- A reply to a soft-deleted original is still returned with `replyTo.isDeleted: true` and `content: null`.

## Editing rules (`MessageService.edit`)

- Must be the sender, not deleted, with existing non-empty text (attachments are allowed; only the caption changes).
- Voice messages are never editable: `WsException('voice messages cannot be edited')`.
- Forwarded messages are never editable: `WsException('forwarded messages cannot be edited')`.
- Attachment-only messages are rejected: `WsException('messages without text cannot be edited')`.
- Non-owners get `WsException('you can only edit your own messages')`; empty new text gets `'message content is required'`; missing/deleted get `'message not found'`.
- Sets `isEdited: true` and returns the full message with attachments/reply/forward fields loaded for the echo.

## Deletion rules (`MessageService.delete`)

- Sender-only soft delete (sets `isDeleted: true`) for every message kind; group owners may delete other members' messages.
- Attachments and their files are cleaned up by the existing delayed cleanup job, while downloads of a soft-deleted message immediately return 404.
- **Deleted messages are filtered from `getPage`** and do not appear in `getMessages`; peers learn of deletion only via the `deleteMessage:list` event.

## History / pagination

`MessageService.getPage(chatId, beforeId?, limit = 30)`:

```ts
where: { chat: { id: chatId }, isDeleted: false, ...(beforeId ? { id: LessThan(beforeId) } : {}) }
order: { id: 'DESC' }
take: limit + 1   // the extra row only computes hasMore; never returned
```

Ack data:

```ts
{
  messages: MessageDto[],  // newest first WITHIN the page, at most `limit`
  hasMore: boolean,        // another older page exists
  nextCursor: number | null // id of the OLDEST message in the page; null when empty
}
```

- No `beforeId` → latest page (backwards compatible with old clients).
- `beforeId` is exclusive (`id < beforeId`); pass the previous `nextCursor`.
- `limit` default 30, min 1, max 100; values above max are rejected by validation (not clamped).
- Deleted messages are excluded, so they never create gaps in the cursor flow.
- Relations: sender (+profile), type, attachments, `replyTo` (id) — one joined query, no N+1.

## ⚠️ Inconsistencies to be aware of

1. Reactions bug (inverted check) — `ReactionsService.reaction` throws `'user already reacted'` when the user **has not** reacted yet (`if (!hasUserReacted) throw ...`), and `unReaction` queries by `reactId` but the stored permission row check is inverted (`reactions.service.ts`). Cant actually add a reaction the first time — noted in feature matrix.
2. `type` field in WS payloads is the entity row (`{id, name}`), not the enum string. Client must map via `type.name`.
3. `deleteMessage:list` emits only the id; the client must find & remove it locally.
4. Deleted messages can be edited/deleted further only while `isDeleted:false` reads — deletion is not checked on `edit` path (`isDeleted: false` IS checked — false alarm, only noted).
5. The gateway emits broadcasts to rooms; **callers never get an ack payload** — rely on receiving `sendMessage:list` to confirm the send. Unsent validation failures surface as WS errors only, so implement send-time optimistic UI carefully.
