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
| `getAllChats` | none (`{}` ignored) | `wsPayload` | `{ok:true, data: ChatDto[]}` — serialized chat rows with `lastMessage` and the caller's authoritative `unreadCount` (capped at 100) | ack error |
| `joinChat` | `{ chatId: number }` — **was bare number, changed** | `wsPayload`, `wsIsMemberChat` | `{ok:true, data: ChatDto}` (chat info + `myLastSeenId`/`othersLastSeenId`); also emits `chatInfo` (compat, ignore). **Joining does NOT mark anything read.** | ack error (`You are not a member of this chat` etc.) |
| `markSeen` | `{ chatId: number, lastSeenId: number }` — both positive ints | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat`, `ValidationPipe` | `{ok:true, data: { lastSeenId }}` — effective stored value (may be the previous one on a no-op, `0` for an empty chat) | ack error — `seen message not found in this chat` (id at/below the newest that is not in this chat) |
| `getMessages` | `{ chatId: number, beforeId?: number, limit?: number }` — `beforeId` positive (exclusive cursor), `limit` 1..100 (default 30; above max is **rejected**, not clamped) | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat` | `{ok:true, data: { messages: MessageDto[], hasMore: boolean, nextCursor: number \| null }}` — newest first **within the page**, no `chat` relation; no `beforeId` = latest page (old clients) | ack error (invalid payload is a validation error) |
| `sendMessage` | `{ chatId?: number, userId?: number, content?: string, reply?: number, attachments?: number[], type?: 'text' }` — text or attachments required; `reply` = id of the message being replied to (must be in the same chat and not deleted; missing/non-numeric = no reply) | `wsPayload`, `wsIsBanMember`, `ValidationPipe` | `{ok:true, data: MessageDto}` including `replyTo` preview (< 1 s in practice) | ack error — invalid payload, attachment misuse, non-member, `reply message not found in this chat (or deleted)` |
| `editMessage` | `{ messageId: number, chatId: number, newContent: string }` (≤ 5000 chars) | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat`, `ValidationPipe` | `{ok:true, data: MessageDto}` | ack error — own text messages only |
| `deleteMessage` | `{ messageId: number, chatId: number }` | same as editMessage | `{ok:true, data: null}` | ack error |
| `leaveChat` | none | `wsPayload` | `{ok:true}` | ack error |
| `userTyping` / `userEndTyping` | `{ chatId: number }` — **was bare number, changed** | `wsPayload` (silently ignored outside the joined GROUP chat, for banned users, and for `userTyping` within 1 s of the previous one) | `{ok:true}` (typing never surfaces errors) | — |
| `addReaction` / `removeReaction` | `{ messageId, reactId, chatId }` | `wsPayload`, `wsIsBanMember`, `wsIsMemberChat` | broadcast only | ack error |

## Server → client events

| Event | Payload | Audience |
|---|---|---|
| `chatInfo` | `ChatDto` | Compat duplicate of the `joinChat` ack; to the joining socket only |
| `getMessages` | `{ messages, hasMore, nextCursor }` | Legacy compat event of the `getMessages` ack; currently not emitted (ignore) |
| `sendMessage:list` | `MessageDto` with top-level `chatId`, `senderId`, `sender`, `type`, `attachments` (see messages.md) | `chat:<chatId>` room, including the sender (sender's UI confirmation + echo dedupe) |
| `editMessage:list` | `MessageDto` | `chat:<chatId>` room |
| `deleteMessage:list` | `number` (message id) | `chat:<chatId>` room |
| `chatlist:updated` | `{ chatId, lastMessage: { id, content, senderId, createdAt, attachments[] } }` | each member's `user:<id>` room (delivered even when the member is not connected to a chat screen; requires connection auth — now fixed) |
| `seen` | `{ chatId, userId, lastSeenId: number \| null }` | `chat:<chatId>` room **only when a `markSeen` actually advances a position** (never on join) |
| `chat:read` | `{ chatId, unreadCount: 0 }` | every socket of the caller's `user:<id>` room when their `markSeen` changes state (other devices clear the badge) |
| `chat:members` | `{ chatId, membersCount }` — non-banned member count | `chat:<chatId>` room after a membership change (add-by-phone, invite join, kick, leave, ban, unban) |
| `countUsersOnline` | `number` (distinct users in room) | `chat:<chatId>` room |
| `typing:start` / `typing:stop` | `{ chatId, userId, userName }` (`userName` = profile name → username → `''`) | `chat:<chatId>` room, not the typer. GROUP chats only; also sent on leave/disconnect |
| `reaction:added` / `reaction:removed` | raw reaction row | `chat:<chatId>` room |
| `connect_error` (handshake) | `"token in valid"` | client with invalid token |

## Client behavior rules

- **History source:** the `getMessages` ack (with `joinChat`'s ack = chat info). The page is newest-first within itself; `nextCursor` is the id of its oldest message (null for an empty page). Older pages: request again with `beforeId = nextCursor` until `hasMore = false`. The app keeps the cache ascending and merges pages by id. The compat `getMessages` emit is ignored (and currently not sent).
- **Send confirmation:** the `sendMessage:list` echo replaces the optimistic pending bubble (content match); ack failure or timeout flips the bubble to failed/retryable with the server message.
- **Reconnect:** socket.io-client auto-reconnects onto a (possibly re-authenticated) handshake; the client re-`joinChat`s its open chat and refetches history/chat list on every (re)connect after the first. Listeners attach per-effect to the one long-lived socket instance and are removed on cleanup — no duplication.
- **leaveChat on unmount** (`useLeaveChatRoomOnUnmount`) never breaks a leave→join of the same chat: re-joining simply rejoins the room and re-reads state.
- **Typing:** group-only. The sender caches its display name and chat type at `joinChat`; `userTyping` is throttled server-side to one broadcast per second per socket, `userEndTyping` is always delivered, banned/non-room members are ignored, and the gateway never throws. Clients show a 5 s safety expiry and clear the user on a live message. Private chats send/receive nothing.
- **Read advancement:** the app sends `markSeen { chatId, lastSeenId }` with the newest confirmed message id only while the chat is focused, `AppState === 'active'` and the list is near the bottom (debounced ~300 ms, monotonic). `joinChat`/`leaveChat` never mark read. `lastSeenId` is clamped to the chat's newest message; ids above it are accepted and clamped. A no-op acks the previous value and emits nothing.
- **Unread:** `unreadCount` from `getAllChats` is authoritative = non-own, non-deleted messages with id > the caller's stored seen id (all such messages when no row exists), capped at 100 (UI shows `99+`). Live `chatlist:updated` events carry no count; the app increments locally (unless the sender is me or that chat is being read) and resyncs on focus/reconnect. `chat:read`/`seen` reset it.

## Serialization rules

- All entity ids (`id`, `chatId`, `senderId`, `messageId`, `lastSeenId`, `replyToId`, `replyTo.id`) are numbers (`Number(bigint-string)`).
- Message payloads always carry top-level `chatId` and `senderId` plus a REDUCED `sender` (`{ id, name, username, avatars }`, avatars = current photo only), `type: { id, name }`, `attachments[]` with numeric `size`. Profile endpoints still return the full `toUserResponse`.
- Replies carry `replyToId` **and** a compact `replyTo` preview (never the full entity):

```ts
replyTo: {
  id: number,
  content: string | null,   // truncated server-side to ~200 chars; null when isDeleted
  senderId: number,
  senderName: string,
  type: 'text' | 'image' | 'video' | 'file' | 'voice' | 'ice' | string,
  attachmentsCount: number,
  isDeleted: boolean
} | null
```

  History excludes deleted messages themselves, but a reply whose original was soft-deleted still carries `replyTo.isDeleted: true` and `content: null`. Editing a message never changes its `replyTo`; the edit echo/history re-serialize the current preview of the original.
- Chat payloads carry `id`, `type`, `title`, `avatars[]`, `isBan`, `createdAt`, `updatedAt`, `unreadCount` (authoritative on `getAllChats`, `0` elsewhere) — no `lastMessage`/`members` unless explicitly loaded.
- `joinChat`'s chat info adds `myLastSeenId: number | null` (stored before this join; null = never read), `othersLastSeenId: number | null` (max read id among the other non-banned members; drives my single/double ticks; null when nobody else has read) and `membersCount: number` (one count query, ban-role rows excluded by role NAME).
- Typing payloads add `userName` (cached per socket at join; never a per-event DB lookup).
