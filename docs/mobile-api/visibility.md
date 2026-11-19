# Visibility guards (blocked users, banned groups)

Server-enforced visibility built on the existing `user_blocks` table and the
existing `role_chat.name = 'ban'` membership. One central
`VisibilityService` (`src/modules/visibility/visibility.service.ts`) decides,
and the serializer layer hides the same fields as defense in depth.

Blocking is **directional** and never announced: the blocked user is not told,
and no event is sent to them when someone blocks or unblocks them. A banned
group member already knows they were banned.

## Central decisions

| Method                             | Meaning                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `isBlockedBy(viewer, target)`      | `target` has blocked `viewer` (`user_blocks` row `target → viewer`).          |
| `isBlockedBetween(a, b)`           | Either direction exists (message sending).                                    |
| `blockersOfViewer(viewer, ids)`    | Batch: which of `ids` blocked `viewer` (ONE query, used by list serializers). |
| `blockedRelationsInChat(chatId)`   | Block rows whose two users are BOTH members of the chat (realtime fan-out).   |
| `isBannedFromChat(viewer, chatId)` | The viewer's `chat_members` row has the `ban` role.                           |
| `canViewUserProfile`               | `!isBlockedBy`                                                                |
| `canViewGroup`                     | `!isBannedFromChat`                                                           |

Nothing is cached across requests. Every check is one indexed query.

## Error shapes (non-probing)

| Situation                                   | Status | Body                                                                         |
| ------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| Profile hidden by a block, or unknown user  | `404`  | `{ "message": "This profile isn't available", "statusCode": 404 }`           |
| Viewer banned from the group                | `403`  | `{ "message": "You can't access this group", "statusCode": 403 }`            |
| Viewer sends to a user who blocked them     | `403`  | `{ "message": "You cannot send messages to this user.", "statusCode": 403 }` |
| Viewer tries to save a blocker as a contact | `404`  | `{ "message": "This person isn't on the app yet", "statusCode": 404 }`       |

Hidden and non-existent targets answer identically; error bodies never contain
partial profile/group data.

## REST endpoints

| Endpoint                                                    | Guard / behavior                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /user/:userId/profile`                                 | `UserVisibilityGuard` → 404 when the target blocked the caller. `Cache-Control` is unchanged (`private`), the 404 is not cacheable by a shared cache. |
| `GET /user/pv/:userName`                                    | Service check → the same generic 404 for a blocked target (or unknown username).                                                                      |
| `GET /user/search?q=`                                       | Blockers are excluded in SQL (`NOT EXISTS user_blocks WHERE blockerId = target AND blockedId = caller`).                                              |
| `POST /contacts/match`                                      | Same SQL exclusion.                                                                                                                                   |
| `GET /contacts`                                             | A saved contact who blocked the caller stays in the list but is sanitized: `avatars: []`, `username` blank, `alias`/`phone` removed.                  |
| `POST /contacts` (by id/username/phone)                     | Blocked target → generic 404 "This person isn't on the app yet"; no row is created.                                                                   |
| `POST /chats/private`                                       | The peer is sanitized when they blocked the caller (existing chat/history still works).                                                               |
| `GET /chats/:chatId/group`                                  | `GroupVisibilityGuard` → 403 for a banned viewer. No title/description/avatars/membersCount is returned.                                              |
| `GET /chats/:chatId/members`                                | `GroupVisibilityGuard`; members who blocked the caller keep `name` but lose `avatars`, `username`, `isOnline`, `lastSeen`.                            |
| `GET /chats/:chatId/banned`                                 | `GroupVisibilityGuard` (plus the existing `ban_users` permission). Rows are sanitized the same way.                                                   |
| `GET /chats/:chatId/members/:memberId/permissions`          | `GroupVisibilityGuard`.                                                                                                                               |
| `GET /chats/manage/:chatId/members`                         | Legacy route, class `ManagerChatGuard` already rejects the `ban` role; rows are sanitized.                                                            |
| `GET /invites/:code`                                        | Banned viewer → `403` with the existing "You can't join this group" wording (invite side), no title/description/avatar/count.                         |
| `POST /invites/:code/join`                                  | Banned viewer → 403; never joins.                                                                                                                     |
| `POST /chats/:chatId/attachments`, `GET /attachments/:id/*` | Existing membership/ban guards; a banned member cannot read or upload group media.                                                                    |

### Sanitized user fields

Wherever a user other than the caller is embedded (message `sender`, reply
preview `senderName`, `forwardedFrom.name`, private chat `peer`, contacts,
search/match results, group members, banned list, reaction `users[]`), a user
who blocked the caller is reduced to:

- `id` — unchanged
- `name` — unchanged (kept so old messages/rows still render, like a missing photo)
- `avatars` — `[]`
- `biografy`, `description`, `alias`, `phone`, `status` — removed/null
- `username` — `null` or `''`
- `isOnline` — `false`, `lastSeen` — `null`

Groups a viewer is banned from never expose `avatars`, `description` or
`membersCount` through any endpoint or realtime payload.

## Realtime

- `getAllChats` / `joinChat` (`chatInfo`): private chat `peer` and chat-list
  peers are sanitized for the caller. `blockedByMe`/`blockedMe` keep working as
  before.
- `getMessages`, `getPinnedMessages`: `sender`, `replyTo.senderName` and
  `forwardedFrom.name` are sanitized per caller.
- Room broadcasts (`sendMessage:list`, `editMessage:list`, `pinMessage:list`,
  forwarded echoes): when a block relation exists between two members of the
  chat, the gateway emits a per-socket payload (`fetchSockets`), so only the
  blocked viewer loses the sender's details. When no relation exists the fast
  room broadcast is used unchanged.
- `getMessageReactions`: `users[]` is sanitized per caller.
- `group:updated` (title/photos) is sent only to non-banned members. Banned
  members are already removed from the chat room on ban.
- `chatlist:updated` carries only ids and text; no user profile fields.

## Static files (documented limitation)

User and group photos are plain files under `uploads/avatars`, served by
`ServeStaticModule` at `/uploads/**` **without authentication**
(`src/modules/app/app.module.ts`). Hiding the URL in DTOs prevents discovery
through the API, but a previously known direct URL remains reachable. The same
applies to the public `/media/avatars/:size/:fileName` thumbnail route. Making
these files private would require replacing the static mount with an
authenticated controller; that is intentionally out of scope here.

## Tests

- `src/modules/visibility/visibility.service.spec.ts` — direction, batching,
  ban detection and the generic errors.
- `scripts/visibility.js` — HTTP + Socket.IO end-to-end PASS/FAIL run (see the
  header for the required env).
