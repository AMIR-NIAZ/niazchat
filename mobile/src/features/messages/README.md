# messages feature

Messaging is **WebSocket-only** (docs/mobile-api/messages.md), implemented in this feature.

## Client → server (delivered by `messages-socket-api.ts`)
- `sendMessage` (`CreateMessageSocketPayload`), `editMessage`, `deleteMessage` — all via
  `emitWithAck` (the ack carries only errors; there is NO ack payload for sends).
- `sendMessage` is issued with `{ chatId, content }` — `MessageService.sendChat` accepts any
  chat the caller belongs to (private included); `userId` is only needed to *create* a PV chat.
- `getMessages` / `joinChat` reuse `joinChat()` from the chats feature (room join + `chatInfo`
  + history in one call).

## Server → client (handled by `use-chat-messages.ts`)
- `sendMessage:list`, `editMessage:list` — full `MessageDto` broadcasts to the chat room; the
  sender receives its own echo, which is how a send is confirmed in the UI.
- `deleteMessage:list` — just the message id; the entry is removed from the cache.
- `getMessages` — last 50, DESC, only to the caller; reversed to ascending here.

## UI
- `message-bubble.tsx` / `message-composer.tsx` consume only the `ChatMessage` domain model
  (`messages-model.ts`) produced by `messages-mapper.ts`.

## Backend limitations surfaced (not faked)
- No pagination — history is fixed at the last 50 messages.
- No ack payload for sends — optimistic bubbles stay pending until the echo; a 10 s ack
  timeout marks them failed (tap to retry).
- Deleted messages never appear in history — live `deleteMessage:list` removals only.
- Reactions and presence are broken server-side; not implemented in this feature.
