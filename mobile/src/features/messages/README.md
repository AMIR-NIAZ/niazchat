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
- `getMessages` — one page (`limit` 30, `beforeId` cursor), newest first within the page;
  reversed to ascending here. `loadOlder()` merges older pages into the ascending cache.
- `seen` — another member advanced their read position → cache `othersLastSeenId` (my ticks).
- `markSeen` — `use-mark-seen.ts` sends the newest confirmed id only while focused +
  app active + near the bottom (300 ms debounce, monotonic); clears the chat-list badge.

## Read state
- `ChatMessage` stores no read flag. Ticks derive from `ConversationDetail.othersLastSeenId`:
  pending → clock, confirmed and `id > othersLastSeenId` → one tick, `id <=` → two ticks
  (group: at least one other member; private: the peer).
- `ConversationDetail.myLastSeenId` drives a one-shot "New messages" divider captured when
  the chat opens; it stays while open even after `markSeen`.

## Forwarding
- Action sheet → **Forward** (one message) or **Select** (id-based selection, max 20).
- `forward-picker.tsx` searches the cached chat list, multi-selects up to 5 targets, and calls
  `forwardMessages` once per attempt. A network retry reuses the same `requestId`; a partial
  retry uses a new one for only the failed target ids.
- `forward-helpers.ts` owns selection/pruning, target limits, search, result merging and request ids.
- Forwarded bubbles show `↗ Forwarded from <name>` above content/reply; tapping a known user opens
  the existing profile helper. Edit is hidden and the server rejects `editMessage`.

## Message actions
- Long-press anywhere on a confirmed bubble opens the sheet, including photo/video tiles,
  the voice player controls and waveform/time, document rows, forwarded headers and reply quotes.
  Interactive children receive the same `onLongPress` (400 ms) so they cannot swallow it.
- `message-actions.ts#getMessageActions` is the single action rule set: Reply/Forward/Select for
  every confirmed message, Delete for own messages (or the group owner), Edit only for own,
  non-forwarded messages with existing non-empty text that are not voice. A message with
  attachments uses "Edit caption"; attachment-only messages have no Edit.
- Deleting closes a viewer for the same message, stops its voice playback, and best-effort
  removes local document/voice cache files after the server confirms.

## UI
- `message-bubble.tsx` / `message-composer.tsx` consume only the `ChatMessage` domain model
  (`messages-model.ts`) produced by `messages-mapper.ts`.
- `forwardedFrom` is part of the wire/domain model and survives `mergeMessages`/echo replacement.

## Backend limitations surfaced (not faked)
- No ack payload for sends — optimistic bubbles stay pending until the echo; a 10 s ack
  timeout marks them failed (tap to retry).
- Deleted messages never appear in history — live `deleteMessage:list` removals only.
- Reactions and presence are broken server-side; not implemented in this feature.
