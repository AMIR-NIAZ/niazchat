# Chats

Sources: `src/modules/chats/controllers/chats.controller.ts`, `src/modules/chats/controllers/manageChats.controller.ts`, `src/modules/chats/services/chat.service.ts`, `src/modules/chats/services/inviteLink.service.ts`.

The blueprints for chat entities and membership roles/permissions live in [entities.md](./entities.md) and [groups.md](./groups.md).

## How the client gets its chat list

**There is no REST endpoint for it.** `ChatService.getUserChats` is only exposed over WebSocket (event `getAllChats`, [websocket.md](./websocket.md)). `ChatService.getAllUser` (member list for a chat) is implemented in the service but **never wired to any controller or gateway** — don't rely on it.

A chat-list item is a raw `Chat` entity row (`getUserChats` returns `m.chat` with no relations resolved except what eager mapping creates), i.e.:

```json
{
  "id": 42,
  "createdAt": "...",
  "updatedAt": "...",
  "title": null,          // private chats have no title
  "avatars": [],
  "type": "groupe",
  "isBan": false,
  "unreadCount": 3,        // non-own, non-deleted messages newer than my seen id (capped 100)
  "lastMessage": { ... }  // same preview shape as chatlist:updated, null when empty
}
```

> `messages` and `members` are **not** included in `getAllChats` — the client merges `chatlist:updated` for previews and fetches history per chat. `unreadCount` is computed in one grouped query for the whole list; it is authoritative, while live increments are a client-side estimate until the next refetch.

## REST endpoints

### `POST /chats/create` — create a group

- `@Role([RoleEnum.ALL])`, body `createChatDto` (`src/modules/chats/dtos/createChat.dto.ts`):

```json
{
  "title": "نام گروه (حداکثر ۲۰)",  // @IsString @MaxLength(20)
  "members": [7, 12]               // @IsArray @ArrayMinSize(1)  — user IDs (numbers)
}
```

- Behavior (`ChatService.createGroup`): duplicates and the caller's own id are filtered out; caller is added as chat role `admin`, others as `user`.
- **Response:** `{ "message": "group created successfully" }` — **the new chat id is NOT returned.** Refetch the chat list over WS to obtain it.
- Note: `TypeChatEnum.CHANNEL` is never used by any creation path.

### `POST /chats/:chatId/ban`

- `@Role([RoleEnum.ADMIN])` (platform admin). Bans the chat (404 if not a non-private/unbanned chat). Returns `{ "message": "chat is ban successfully" }`. Duplicated inside `manageChats.controller.ts` as `POST /chats/manage/ban/:chatId` but requires `ManagerChatGuard` membership there.

### `POST /chats/join/:code`

- `@Role([RoleEnum.ALL])`, invite-code from `:code`. Source: `InviteLinkService.joinByInviteCode`.
- Errors: 400 `Invalid or expired invite link`, `Invite link has expired`, `Invite link usage limit reached`, `You are already a member of this chat`.
- **Success returns the full raw `Chat` entity with relations (`TypeORM` save result)**:

```json
{
  "id": 42, "createdAt": "...", "updatedAt": "...",
  "title": "...", "avatars": [], "type": "groupe", "isBan": false,
  "chatSeen": [...], "messages": [...], "members": [...],
  "lastMessageId": null
}
```

> ⚠️ This leaks the entire entity graph (all member rows, messages, seen rows). Treat it as noise; actual membership galleries should still be refetched.

## Chat management (`/chats/manage/*`, guard `ManagerChatGuard`)

Every route here first goes through `ManagerChatGuard` (`src/common/guards/restGuards/ManagerChatGuard.guard.ts`): the caller must be chat role `manager` (all routes allowed) **or** chat role `admin` **with the permission(s)** demanded by `@PermissionAdminChat([...])`. It resolves the chat from **`:chatId`** (routes that use it) or from **`:memberId` → its chat** (member routes). If neither param exists → 400 `chat id or member id not valid. Not a chat manager`. Failure → 403 (filter rewrites the message to `user not access`).

| Method & URL | Additional permission | Body | Response (`ChatService`/`PermissionChatService`) |
|---|---|---|---|
| `POST /chats/manage/:groupId/add/:userPhone` | `all` | – | `{ message: 'user added succeccfull' }` (adds by phone to role `user`; no chat-existence check for private chats!) |
| `POST /chats/manage/upload/avatar/:chatId` | `change_info_chat` | multipart field **`avatar`** | `{ message: 'avatar updated successfully' }` (path appended to `chat.avatars`) |
| `DELETE /chats/manage/delete/avatar/:chatId` | `change_info_chat` | `{ "avatar": "<path from chat.avatars>" }` | `{ message: 'avatar updated successfully' }`; 404 when path not in array |
| `POST /chats/manage/ban/:memberId` | `ban_user` | – | `{ message: 'user baned successfully' }` (member's chat role → `ban`) |
| `POST /chats/manage/onban/:memberId` | `ban_user` | – | `{ message: 'user on baned successfully' }` (role → `user`) |
| `GET /chats/manage/:chatId/bans` | `ban_user` | – | `{ data: [{ ...ChatMember row, user: toUserResponse(...) }] }` — banned members only |
| `POST /chats/manage/ban/:chatId` | – (needs platform `admin`) | – | same as `/chats/:chatId/ban` but through `ManagerChatGuard` |
| `POST /chats/manage/admin/add/:memberId` | – | `{ permissions: PermissionChatEnum[] }` | `{ message: 'admin added successfully' }` — promotes member to chat-admin (replaces their permission set) |
| `DELETE /chats/manage/admin/delete/:memberId` | – | – | `{ message: 'admin removed successfully' }` (chat role → `user`, permissions erased) |
| `POST /chats/manage/admin/permissions/:memberId` | – | `{ permissions: PermissionChatEnum[] }` | `{ message: 'permissions added successfully' }` — ⚠️ looks up role **`ban`** where `admin` was surely intended (`permissionChat.service#addPermissionforAdmin`) — likely broken for real admins |
| `DELETE /chats/manage/admin/permissions/:memberId` | – | `{ permissions: PermissionChatEnum[] }` | `{ message: 'permissions deleted successfully' }` |
| `GET /chats/manage/admin/permissions/:memberId` | – | – | `{ permissions: string[] }` (names) |
| `POST /chats/manage/:chatId/link` | `change_info_chat` | `createLinkDto` (below) | full `Link` entity |
| `GET /chats/manage/:chatId/link` | – | – | array of `Link` entities (`id, code, usageLimit, usageCount, expiresAt, isActive, chatId, createdAt, updatedAt`) |
| `DELETE /chats/manage/:chatId/link/:linkId` | – | – | deactivates the link (204-ish, `InviteLinkService.notActiveInviteLink` returns void) |

`createLinkDto` (`src/modules/chats/dtos/createLink.dto.ts`):

```json
{
  "chatId": 42,          // required number
  "usageLimit": 10,      // optional Min(0), default 0 (= unlimited)
  "expiresAt": "2026-12-01T00:00:00Z"  // optional IsDateString
}
```

Note: the backend generates `code` as **32 hex chars** (`randomBytes(16).toString('hex')`) although the DB column is `length: 20` — that mismatch makes link creation fail at the DB level unless the column is migrated. Flagged in the summary.

## Inconsistencies found

1. `createLink.code` is 20 chars in the entity but the generated code is 32 chars (`src/modules/chats/entities/link.entity.ts` vs `InviteLinkService.generateUniqueCode`) → likely runtime insert error.
2. `addMemberByPhone` has typo response and does not verify the target user exists → DB FK error surfaces as 500.
3. `addPermissionforAdmin` searches for role `BAN` instead of `ADMIN` (`src/modules/chats/services/permissionChat.service.ts#addPermissionforAdmin`).
4. There is no "leave chat", "remove member", "edit title", or "list members" REST route — membership changes via invite links/admin add only.
