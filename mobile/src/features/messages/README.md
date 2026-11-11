# messages feature

Messaging is **WebSocket-only** (docs/mobile-api/messages.md), implemented in this feature.

## Client → server (delivered by `messages-socket-api.ts`)
- `sendMessage` (`CreateMessageSocketPayload`), `editMessage`, `deleteMessage` — all via
  `emitWithAck` (the ack carries only errors; there is NO ack payload for sends).
- `reactMessage` — one reaction per user/message; the same emoji again (or `null`)
  removes it. `getMessageReactions` loads the grouped reactor list for the sheet.
- `sendMessage` is issued with `{ chatId, content }` — `MessageService.sendChat` accepts any
  chat the caller belongs to (private included); `userId` is only needed to *create* a PV chat.
- `getMessages` / `joinChat` reuse `joinChat()` from the chats feature (room join + `chatInfo`
  + history in one call).

## Server → client (handled by `use-chat-messages.ts`)
- `sendMessage:list`, `editMessage:list` — full `MessageDto` broadcasts to the chat room; the
  sender receives its own echo, which is how a send is confirmed in the UI.
- `deleteMessage:list` — just the message id; the entry is removed from the cache.
- `reaction:updated` — personalized snapshot (`reactions[{ emoji, count }]`,
  `myReaction`, `actor`; never `userIds`). `applyReactionUpdate` replaces counts
  and keeps the caller's own reaction when the payload omits it.
- `getMessages` — one page (`limit` 30, `beforeId` cursor), newest first within the page;
  reversed to ascending here. `loadOlder()` merges older pages into the ascending cache.
- `seen` — another member advanced their read position → cache `othersLastSeenId` (my ticks).
- `markSeen` — `use-mark-seen.ts` sends the read target only while focused + app active
  (300 ms debounce, monotonic); clears the chat-list badge. The target is the newest
  confirmed id at the bottom, otherwise the highest id among currently visible rows, so
  opening on the unread divider and reading older history both advance the receipt.
  `ReadReceiptRunner` owns the dedupe/retry state: one request in flight, transient
  failures retried twice (1.5 s/3 s), an unacknowledged position re-armed on
  focus/foreground/reconnect, and server rejections never retried.
- The chat room follows FOCUS (`active-room.ts`): blur leaves `chat:<id>`, focus re-joins
  it with one fresh page + `othersLastSeenId` (`useChatMessages.ensureActive`). This is what
  keeps `seen`/message events alive when a chat is pushed over another (profile, forwarded
  target, the same chat opened again) and the backend's one-room-per-socket rule kicks the
  hidden screen out.

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

## Reactions
- Message payloads carry count-only `reactions`; history acks also carry the caller's
  `myReaction`. `mergeMessages` and `replaceMessage` keep a cached `myReaction` when a
  broadcast echo omits it.
- The emoji list comes from `GET /react` (`useReactionEmojis`, cached with a long
  `staleTime`) with the fixed `👍 ❤️ 😂 😮 😢 🙏` fallback. `normalizeEmoji` strips
  `U+FE0F` and whitespace for comparisons.
- The action sheet opens with a horizontal quick bar at the top (the caller's current
  emoji highlighted). Tapping sends `reactMessage`, closes the sheet, applies an
  optimistic update and rolls back with a short message if the ack fails. Taps for a
  message already in flight are ignored.
- Chips render inside the bubble above the meta line, wrap within the 85% bubble width,
  and use the accent color for the caller's chip. Tapping a chip toggles that emoji;
  long-pressing one opens `MessageReactionsSheet` (`getMessageReactions`) with grouped
  users, loading/error/retry/empty states, and profile navigation (self is inert).

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
- Presence is still broken server-side (documented in the websocket contract); reactions are implemented end to end.
