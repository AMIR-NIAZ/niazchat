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
| `joinChat` | `chatId` (bare number) | join chat room; returns `chatInfo` to caller too; also triggers `seen` + `countUsersOnline` |
| `leaveChat` | – | leave current chat room; triggers `typing:stop` and `seen`/`countUsersOnline` first |
| `userTyping` | `chatId` | broadcast `typing:start` to the chat room (not to the caller) |
| `userEndTyping` | `chatId` | broadcast `typing:stop` |
| `sendMessage` | `CreateMessageDto` | sends; broadcasts `sendMessage:list`, `chatlist:updated` (see messages.md). **No ack to sender.** |
| `editMessage` | `EditMessageDto` `{ messageId, chatId, newContent(≤5000) }` | broadcasts `editMessage:list` |
| `deleteMessage` | `deleteMessageDto` `{ messageId, chatId }` | broadcasts `deleteMessage:list` (just messageId) |
| `getMessages` | bare `chatId` number | `getMessages` back to caller only |
| `addReaction` | `ReactionDto` `{ messageId, reactId, chatId }` | broadcasts `reaction:added` |
| `removeReaction` | `ReactionDto` | broadcasts `reaction:removed` |

## Server → client events (full list with examples)

```ts
/** getAllChats — to the requesting client */
socket.on('getAllChats', (chats: Chat[]) => {})

/** chatInfo — to the client that just joinChat-ed */
socket.on('chatInfo', (chat: Chat) => {})

/** seen — to everyone in the chat room */
{
  "chatId": 42,
  "userId": 7,
  "lastSeenId": 999        // message id the viewer has read up to
}

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
/** getMessages — Message[] (last 50, DESC order) */
/** reaction:added — MessageReact entity (raw): { id, createdAt, updatedAt, userId, messageId, reactId, react: React } */
/** reaction:removed — the MessageReact row that was removed (same shape) */
```

## RampWelcome / read-received flow

- Joining a chat emits `seen` (marks all prior messages read for the joining user via `ChatService.seening`, persists `chat_seen` row and emits `lastSeenId`).
- Leaving (`leaveChat` or socket disconnect) triggers the same `seen` emission again, so peers get the final read position.
- **There is no per-message `read` event** — one `lastSeenId` per (user, chat) pair; clients infer "read by X" by comparing message ids.

## Reactions gateway (broken)

- `addReaction` throws `'user already reacted'` when the user has **no** user-react record yet (inverted guard, `ReactionsService.reaction`), making first reactions impossible. Order is preserved only for duplicates (` findOne` of any user-react regardless of reactId) — inconsistent with one-react-per-message UX.
- `removeReaction` checks `reactId` belonging to that user correctly, but the error message `'react not found'` is used both for completely new and for wrong-react cases.

## Broken presence (`UserGateway`)

`UserGateway.handleConnection` reads `client.data.user` — but nothing populates it: the gateway has **no `wsPayload` guard** (note `chats.gateway.ts` and others decorate), so `user` is always undefined → `handleConnection` returns early, `isOnline/lastSeen` are never updated, and the `user:<id>` personal room is never joined (`chatlist:updated` and the personal `seen` never reach you). **Final verdict:** presence is not usable until fixed server-side.

## Reconnection guidance for the client

The server gives no reconnection semantics beyond standard Socket.IO:

- After reconnect, re-do: `getAllChats`, `joinChat` for the open chat, `getMessages` to refresh history, and re-emit typing state if needed. The client must also re-emit nothing else — room memberships are per-socket.
- On event-error (validation/permissions), catch emission errors: Nest wraps thrown Ws/HttpException as standard Socket.IO `{ message, status }` payloads when using the default WsExceptionFilter (the WS path uses the default unreconfigured pipe; assertion detail — the backend does not configure WS filters, so the JSON shape is `{ message, ... }`).

## Unimplemented-from-client views

- `chatlist:updated` never marks `lastMessage` for chats with **no** messages (`getAllChats` returns `lastMessageId` null); the client must handle empty chats.
