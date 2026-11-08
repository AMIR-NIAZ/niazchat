# Messages

Sources: `src/modules/messages/gateways/message.gateway.ts`, `src/modules/messages/services/message.service.ts`, `dtos/createMessage.dto.ts`, `EditMessage.dto.ts`, `deleteMessage.dto.ts`.

**Important:** messages have **no REST endpoints at all** (`/src/modules/messages` contains no controllers). Everything goes through Socket.IO — see [websocket.md](./websocket.md).

## Client → server events

| Event | Payload (`class-validator` on WS) | Purpose |
|---|---|---|
| `sendMessage` | `CreateMessageDto` | Send to a group chat or start a private chat |
| `editMessage` | `EditMessageDto` | Edit own text message |
| `deleteMessage` | `deleteMessageDto` | Soft-delete own message |
| `getMessages` | `GetMessagesDto`: `{ chatId, beforeId?, limit? }` | Fetch one page of a chat's history (newest first; see [History / pagination](#history--pagination)) |

### `CreateMessageDto` (`src/modules/messages/dtos/createMessage.dto.ts`)

```json
{
  "chatId": 42,            // required if group chat; optional otherwise
  "userId": 7,             // required for PV messages (receiver user id)
  "content": "text ≤5000", // required for text-only messages (MaxLength(5000))
  "reply": 123,            // optional number: MessageId being replied to
  "attachments": [12],     // optional, 1..10 attachment ids (see attachments.md)
  "type": "text"           // optional, TypeMessageEnum — defaults to text
}
```

`sendChat` requires membership (`BadRequestException 'user not exit in chat'`). `sendPv` finds or creates a private Chat between the two users (`MessageService.sendPv`).

`type` values: `text` | `image` | `video` | `file` | `voice` | `ice`. Note: only `text` (`TextContentHandler`) is registered in the content-handler pool (`message.module.ts`) — for other types the `ContentResolverService` would throw `Unsupported message type`, **but it isn't actually invoked in the create flow**; the server treats them as text today.

### Validation failures (from the global WS `ValidationPipe`)

```json
/** ExceptionFilter format (useWsExceptionFilter in websocket.md) */
{ "message": ["chatId must be a number"], "status": 400 }
```

`sendMessage` without `chatId` or `userId` → `WsException('Bad Request Exception')` style throw.

## Server → client events (broadcast to room)

| Event | Emitted to | Payload (raw `Message` entity + populated relations) |
|---|---|---|
| `sendMessage:list` | room `chat:<chatId>` | full serialized Message (sender → `{ id, name, username, avatars }`, type, attachments) |
| `editMessage:list` | room | updated message (`isEdited: true`) |
| `deleteMessage:list` | room | **just the number** `dto.messageId` |
| `getMessages` | ack only | `{ messages, hasMore, nextCursor }` (ack data; desc by id within the page) |
| `chatlist:updated` | each member's `user:<id>` room | chat-list preview payload (see below) |

### `chatlist:updated` payload

```json
{
  "chatId": 42,
  "lastMessage": {
    "id": 999,
    "content": "hello",
    "senderId": 7,
    "createdAt": "...",
    "attachments": [{ "id": 12, "originalName": "...", "mimeType": "...", "size": 12345 }]
  }
}
```

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
  replyTo: {              // compact quoted preview, null when not a reply
    id: number,
    content: string | null, // ~200-char truncation; null when isDeleted
    senderId: number,
    senderName: string,
    type: string,
    attachmentsCount: number,
    isDeleted: boolean
  } | null,
  attachments: [{
     id: number, originalName: string, mimeType: string,
     size: number, createdAt: string, messageId: number, uploaderId: number,
     storageKey: string, status: 'attached', chatId: number
  }] | []
}
```

(`getMessages`/`loadMessage` output above, from `MessageService.getPage` and `loadMessage`. `select` hides most Attachment columns except in the list — some attachments come from relations.)

## Reply rules

- `sendMessage.reply` is validated server-side: the original must exist in the **same chat** and have `isDeleted: false`, otherwise `BadRequestException 'reply message not found in this chat (or deleted)'`.
- Missing/non-numeric `reply` means "no reply" (normalized, not rejected).
- Reply-to-a-reply is allowed; only one preview level is serialized (`replyTo`).
- A reply to a soft-deleted original is still returned with `replyTo.isDeleted: true` and `content: null`.

## Editing rules (`MessageService.edit`)

- Must be the sender (`sender: { id: user.sub }`), not deleted, and message `type.name === 'text'`.
- Otherwise `WsException('message not found')` / `'only text messages can be edited'`.
- Sets `isEdited: true`.

## Deletion rules (`MessageService.delete`)

- Sender-only soft delete (sets `isDeleted: true`).
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
