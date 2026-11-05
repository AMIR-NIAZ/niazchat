# WebSocket contract (source of truth)

Applies after the 2026-11 standardization. Socket.IO v4, no namespace, origin = API origin (`PORT`). Version on the wire: all ids are **numbers** (backend bigint columns are serialized to numbers in WS payloads by `ws-serializer.utils.ts`); timestamps are ISO strings.

## Connection & auth

- Handshake: `io(BASE_URL, { transports: ['websocket'], extraHeaders: { authorization: 'Bearer <accessToken>' } })`. The `auth: { token }` baggage field is accepted but unused server-side.
- **Connection middleware (all gateways share one io server):** the access token is verified at handshake; an invalid/expired token fails the handshake → `connect_error` with `"token in valid"`. The user socket then joins its personal room `user:<userId>`; `isOnline/lastSeen` bookkeeping runs in `UserGateway`.
- **Per-event guard `wsPayload`** re-verifies the same header on every event (defense in depth).
- Rooms: `user:<id>` (personal, joined automatically at connect) and `chat:<id>` (joined via `joinChat`, left via `leaveChat`/`joinChat` of another chat/disconnect).

## Standard request/response pattern

Every client→server **request** event acks exactly once, as the ack callback's **first argument**:

```ts
// success
{ ok: true, data?: T }
// failure (produced by WsExceptionFilter from guards, pipes or handlers)
{ ok: false, message: string, status: number }
```

Never a raw `exception` event unless the caller omitted an ack callback. Guard/pipe/handler errors use the same shape. Client code: one `request<T>(event, payload)` helper with a single timeout; rejection on `ok:false`, timeout, or missing ack.

## Client → server events

| Event | Payload (exact) | Guards | Success ack | Failure |
|---|---|---|---|---|
| `getAllChats` | none (`{}` ignored) | `wsPayload` | `{ok:true, data: ChatDto[]}` (serialized Chat rows, `lastMessage` not loaded) | ack error |
| `joinChat` | `{ chatId: number }` — **was bare number, changed** | `wsPayload`, `wsIsMemberChat` | `{ok:true, data: ChatDto}` (chat info); also emits `chatInfo` (compat, ignore) | ack error (`You are not a member of this chat` etc.) |
| `getMessages` | `{ chatId: number }` | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat` | `{ok:true, data: MessageDto[]}` — last 50, **DESC**; no `chat` relation; also emits `getMessages` (compat, ignore) | ack error |
| `sendMessage` | `{ chatId?: number, userId?: number, content?: string, reply?: number, attachments?: number[], type?: 'text' }` — text or attachments required | `wsPayload`, `wsIsBanMember`, `ValidationPipe` | `{ok:true, data: MessageDto}` (< 1 s in practice) | ack error — invalid payload, attachment misuse, non-member |
| `editMessage` | `{ messageId: number, chatId: number, newContent: string }` (≤ 5000 chars) | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat`, `ValidationPipe` | `{ok:true, data: MessageDto}` | ack error — own text messages only |
| `deleteMessage` | `{ messageId: number, chatId: number }` | same as editMessage | `{ok:true, data: null}` | ack error |
| `leaveChat` | none | `wsPayload` | `{ok:true}` | ack error |
| `userTyping` / `userEndTyping` | `{ chatId: number }` — **was bare number, changed** | `wsPayload` | `{ok:true}` | ack error |
| `addReaction` / `removeReaction` | `{ messageId, reactId, chatId }` | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat` | broadcast only | ack error |

## Server → client events

| Event | Payload | Audience |
|---|---|---|
| `chatInfo` | `ChatDto` | Compat duplicate of the `joinChat` ack; to the joining socket only |
| `getMessages` | `MessageDto[]` | Compat duplicate of the `getMessages` ack; to the requesting socket only |
| `sendMessage:list` | `MessageDto` with top-level `chatId`, `senderId`, `sender`, `type`, `attachments` (see messages.md) | `chat:<chatId>` room, including the sender (sender's UI confirmation + echo dedupe) |
| `editMessage:list` | `MessageDto` | `chat:<chatId>` room |
| `deleteMessage:list` | `number` (message id) | `chat:<chatId>` room |
| `chatlist:updated` | `{ chatId, lastMessage: { id, content, senderId, createdAt, attachments[] } }` | each member's `user:<id>` room (delivered even when the member is not connected to a chat screen; requires connection auth — now fixed) |
| `seen` | `{ chatId, userId, lastSeenId: number \| null }` — `null` for empty chats | `chat:<chatId>` room on join (and read-position updates) |
| `countUsersOnline` | `number` (distinct users in room) | `chat:<chatId>` room |
| `typing:start` / `typing:stop` | `{ chatId, userId }` | `chat:<chatId>` room, not the typer |
| `reaction:added` / `reaction:removed` | raw reaction row | `chat:<chatId>` room |
| `connect_error` (handshake) | `"token in valid"` | client with invalid token |

## Client behavior rules

- **History source:** the `getMessages` ack (with `joinChat`'s ack = chat info). The compat emits are ignored by the app.
- **Send confirmation:** the `sendMessage:list` echo replaces the optimistic pending bubble (content match); ack failure or timeout flips the bubble to failed/retryable with the server message.
- **Reconnect:** socket.io-client auto-reconnects onto a (possibly re-authenticated) handshake; the client re-`joinChat`s its open chat and refetches history/chat list on every (re)connect after the first. Listeners attach per-effect to the one long-lived socket instance and are removed on cleanup — no duplication.
- **leaveChat on unmount** (`useLeaveChatRoomOnUnmount`) never breaks a leave→join of the same chat: re-joining simply rejoins the room and re-reads state.

## Serialization rules

- All entity ids (`id`, `chatId`, `senderId`, `messageId`, `lastSeenId`, `replyToId`) are numbers (`Number(bigint-string)`).
- Message payloads always carry top-level `chatId` and `senderId` plus the `sender` user-response (`toUserResponse`), `type: { id, name }`, `attachments[]` with numeric `size`.
- Chat payloads carry `id`, `type`, `title`, `avatars[]`, `isBan`, `createdAt`, `updatedAt` — no `lastMessage`/`members` unless explicitly loaded.
