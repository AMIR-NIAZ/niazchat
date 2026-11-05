# Groups (group roles, permissions & members)

Sources: `src/modules/chats/entities/chat_members.entity.ts`, `role_chat.entity.ts`, `permission_chat.entity.ts`, `permission_admin.entity.ts`, `src/modules/chats/services/chat.service.ts#getAllBanUser`, `src/modules/chats/services/permissionChat.service.ts`.

## Role model per chat (`role_chat` table)

Seeded values (`src/modules/seeders/seeds/roleChat.seeder.ts`) = `RoleChatEnum` (`src/common/enums/roleChat.enum.ts`):

| Role | Meaning |
|---|---|
| `manager` | Chat owner — full access through `ManagerChatGuard` (`isManageChat`) |
| `admin` | Chat admin — access limited by `permission_admin` rows |
| `user` | Regular member |
| `ban` | Banned member (kept in `chat_members` as join metadata) |

Group creation assigns: creator → `admin`, invited users → `user` (`ChatService.createGroup`). **No user ever becomes `manager` in the current creation flow** (nothing sets the manager role after seeding).

> ⚠️ Not every member row is guaranteed to have a loaded `role` — the service sometimes queries without relations. The response shape for member lists only exists for the banned list (`/:chatId/bans`).

## Member response shape (`GET /chats/manage/:chatId/bans`)

```json
{
  "data": [
    {
      "id": 88,                      // chat_members.id
      "createdAt": "...",
      "updatedAt": "...",
      "chatId": 42,
      "userId": 7,
      "roleId": 3,
      "user": { "...full toUserResponse shape": true }
    }
  ]
}
```

(`select` limits member fields to `id/createdAt/updatedAt`; `user` is `toUserResponse` output, see [users.md](./users.md).)

## Chat-admin permissions (`permission_chat` seeded from `PermissionChatEnum`, `src/common/enums/permissionChat.enum.ts`)

| Value | Grants (`@PermissionAdminChat` usage) |
|---|---|
| `all` | unlocks every managed endpoint for that admin (`ManagerChatGuard` early-true) |
| `change_info_chat` | upload/delete chat avatar, create invite links |
| `ban_user` | ban/unban members, list banned members |
| `delete_message` | seeded but **not checked by any handler** (no REST/WS delete-message-by-admin flow exists) |

Administrative endpoint rules (`ManagerChatGuard`):

- Caller with chat role `manager` → everything allowed.
- Caller with chat role `admin` → allowed only when the route's `@PermissionAdminChat([...])` list is **fully** contained in the admin's `permission_admin` rows (every-check, not any).
- Chat role `user` or `ban` → 403.

## What the mobile client must do

1. To manage members of a group: use `POST /chats/manage/:groupId/add/:userPhone` (lookup by **phone**, not user id).
2. To see banned users: `GET /chats/manage/:chatId/bans`. **There is no REST route listing normal members** — `ChatService.getAllUser` exists but has no controller hookup; member display must be built from message senders + invite/ban data for now.
3. There is no "leave group" or "remove member (non- ban)" endpoint.
4. Renaming a group or changing its title is **not** possible (only avatar management, `change_info_chat`).
