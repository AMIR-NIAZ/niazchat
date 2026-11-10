# WebSocket (Socket.IO)

> **Superseded on the request/response side.** The standardized ack contract
> (`{ ok: true, data }` / `{ ok: false, message, status }` on EVERY request
> event, `{ chatId }`-object payloads, numeric ids, connection-time auth) now
> lives in `docs/mobile-api/websocket-contract.md` — read that file first.
> This document still has useful background below.

Sources: `src/modules/messages/gateways/message.gateway.ts`, `src/modules/chats/gateways/chats.gateway.ts`, `src/modules/auth/gateways/user.gateway.ts`, `src/modules/reactions/gateways/reactions.gateway.ts`, guards in `src/common/guards/wsGuards/`, rooms in `src/common/utils/roomCreator.utils.ts`.

## Connection

- No namespace, no CORS restriction from the gateway config (Nest's HTTP CORS applies). One gateway declares `{ maxHttpBufferSize: 1e6 }` (`MessageGateway`), others use defaults.
- **Authentication is done per-event, not at handshake-time.** Every event passes through the `wsPayload` guard (`src/common/guards/wsGuards/wsPayload.guard.ts`) which reads the **`authorization` header of the Socket.IO handshake**:

```ts
io('http://<host>:3000', {
  extraHeaders: { authorization: 'Bearer <accessToken>' },
  transports: ['websocket'],
});
```

- `wsPayload` verifies the access token JWT and stores `{ sub, role }` on `client.data.user`; failure → `WsException('token in valid')`; **each event is re-authenticated** (emit failure per event, not connection drop).
- **Rooms** (`src/common/utils/roomCreator.utils.ts`): `user:<userId>` (personal room, joined automatically in `UserGateway.handleConnection`) and `chat:<chatId>` (joined via `joinChat` event).

## Event auth summary

| Gateway | Guards (all events) | Extra per event |
|---|---|---|
| MessageGateway | `wsPayload`, `wsIsBanMember` | `wsIsMemberChat` on edit/delete/getMessages |
| ChatGateway | `wsPayload` | `wsIsMemberChat` on joinChat |
| ReactionsGateway | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat` | – |
| UserGateway | **none** | – (broken presence; see below) |

- `wsIsMemberChat` (`src/common/guards/wsGuards/wsIsmemberChat.guard.ts`): takes `chatId` from number payloads (`joinChat`) or `data.chatId ?? data.dto?.chatId` (DTO payloads), 400 `'Invalid chat ID'` otherwise; 400 `'You are not a member of this chat'`.
- `wsIsBanMember` (`wsIsBanMember.guard.ts`): throws `'member not found'` / `'chat id not valid'` / `'user cant access'` for the `ban` role.

## Client → server events

| Event | Payload | Purpose / Response to the caller |
|---|---|---|
| `getAllChats` | – | chat list → `getAllChats` (back to caller only) |
| `joinChat` | `{ chatId }` | join chat room; returns `chatInfo` (with seen state) to caller too; triggers `countUsersOnline` (no longer `seen`) |
| `markSeen` | `{ chatId, lastSeenId }` | monotonic read position; broadcasts `seen` + caller's `chat:read` only on change |
| `leaveChat` | – | leave current chat room; triggers `typing:stop` and `seen`/`countUsersOnline` first |
| `userTyping` | `chatId` | broadcast `typing:start` to the chat room (not to the caller) |
| `userEndTyping` | `chatId` | broadcast `typing:stop` |
| `sendMessage` | `CreateMessageDto` | sends; broadcasts `sendMessage:list`, `chatlist:updated` (see messages.md). **No ack to sender.** |
| `editMessage` | `EditMessageDto` `{ messageId, chatId, newContent(≤5000) }` | broadcasts `editMessage:list` |
| `deleteMessage` | `deleteMessageDto` `{ messageId, chatId }` | broadcasts `deleteMessage:list` (just messageId) |
| `getMessages` | `{ chatId, beforeId?, limit? }` | ack `{ messages, hasMore, nextCursor }` (latest page when `beforeId` is omitted) |
| `reactMessage` | `{ chatId, messageId, emoji: string \| null }` | toggles the caller's one reaction; acks `{ ok: true, data }` and broadcasts `reaction:updated` |

## Server → client events (full list with examples)

```ts
/** getAllChats — to the requesting client */
socket.on('getAllChats', (chats: Chat[]) => {})

/** chatInfo — to the client that just joinChat-ed */
socket.on('chatInfo', (chat: Chat) => {})

/** seen — to everyone in the chat room, only after markSeen advances */
{
  "chatId": 42,
  "userId": 7,
  "lastSeenId": 999        // message id the viewer has read up to
}

/** chat:read — to the reader's other devices (user room) */
{ "chatId": 42, "unreadCount": 0 }

/** countUsersOnline — distinct connected user count in the room; number */
socket.on('countUsersOnline', (count: number) => {})

/** typing:start / typing:stop — to room, excluding the typer */
{ "chatId": 42, "userId": 7 }

/** chatlist:updated — to every member's user room */
{
  "chatId": 42,
  "lastMessage": {
    "id": 999, "content": "hello", "senderId": 7, "createdAt": "...",
    "attachments": [ { id, originalName, mimeType, size } ]
  }
}
/** sendMessage:list, editMessage:list — full Message entity serialization (messages.md) */
/** deleteMessage:list — number (message id) */
/** getMessages ack data — { messages: MessageDto[], hasMore, nextCursor } (newest first per page) */
/** reaction:updated — { chatId, messageId, reactions: [{ reactId, emoji, count }], myReaction, actor } (never userIds) */
```

## Read-received flow

- Reading is explicit: `markSeen { chatId, lastSeenId }` (validated DTO, member + non-banned guards). The server clamps to the chat's newest id, applies `max(existing, given)` monotonic semantics and only then broadcasts `seen { chatId, userId, lastSeenId }` to `chat:<chatId>`; a no-op emits nothing.
- `joinChat`/`leaveChat`/disconnect **do not** mark messages read. Empty chats never throw: joining reports null seen ids and `markSeen` acks `lastSeenId: 0`.
- The caller's other sockets receive `chat:read { chatId, unreadCount: 0 }` in `user:<id>` whenever their position advances.
- **There is no per-message `read` event** — one `lastSeenId` per (user, chat) pair; clients infer "read by X" by comparing message ids. In groups, `othersLastSeenId` (from `chatInfo`) is the max over other members, so ticks mean "seen by at least one other member".

## Reactions gateway

- The legacy `addReaction`/`removeReaction` events were removed (no app or script used them).
- `reactMessage { chatId, messageId, emoji | null }` is the single toggle: same emoji again or `null` removes, a different emoji switches, no row inserts. The message must belong to the chat and not be soft-deleted; the emoji must exist in `reacts`.
- It acks `{ ok: true, data: ReactionSnapshot }` and broadcasts `reaction:updated` to the room. Each recipient gets their own `myReaction`; `reactions[]` carries only `reactId`, `emoji` and `count` — never `userIds`.
- `getMessageReactions { chatId, messageId }` returns the grouped reactor list (`emoji`, `count`, `users[{ userId, name, username, avatars }]`), newest first, at most 100 users total, with the same guards as `reactMessage` and no phone numbers.
- Message payloads (history, send/forward/edit echoes and send acks) carry count-only `reactions`; history acks also carry the caller's `myReaction`. Deleting a message removes its reaction rows; forwarding never copies reactions.
- Reaction types come from the `reacts` table (`GET /react`). Six defaults are seeded idempotently at startup; `POST/PUT/DELETE /react` are admin-only.

## Broken presence (`UserGateway`)

`UserGateway.handleConnection` reads `client.data.user` — but nothing populates it: the gateway has **no `wsPayload` guard** (note `chats.gateway.ts` and others decorate), so `user` is always undefined → `handleConnection` returns early, `isOnline/lastSeen` are never updated, and the `user:<id>` personal room is never joined (`chatlist:updated` and the personal `seen` never reach you). **Final verdict:** presence is not usable until fixed server-side.

## Reconnection guidance for the client

The server gives no reconnection semantics beyond standard Socket.IO:

- After reconnect, re-do: `getAllChats`, `joinChat` for the open chat, `getMessages` to refresh history, and re-emit typing state if needed. The client must also re-emit nothing else — room memberships are per-socket.
- On event-error (validation/permissions), catch emission errors: Nest wraps thrown Ws/HttpException as standard Socket.IO `{ message, status }` payloads when using the default WsExceptionFilter (the WS path uses the default unreconfigured pipe; assertion detail — the backend does not configure WS filters, so the JSON shape is `{ message, ... }`).

## Unimplemented-from-client views

- `chatlist:updated` never marks `lastMessage` for chats with **no** messages (`getAllChats` returns `lastMessageId` null); the client must handle empty chats.
