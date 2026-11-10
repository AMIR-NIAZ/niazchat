# Enums & Shared Types

All enums live in `src/common/enums/`.

## Enum definitions (actual string values)

| Enum | File | Values |
|---|---|---|
| `RoleEnum` | `role.enum.ts` | `owner`, `admin`, `user`, `all` |
| `RoleChatEnum` | `roleChat.enum.ts` | `manager`, `admin`, `user`, `ban` |
| `TypeChatEnum` | `typeChat.enum.ts` | `private`, `groupe` (sic — misspelled in code), `channel` |
| `TypeMessageEnum` | `typeMessage.enum.ts` | `text`, `image`, `video`, `file`, `voice`, `ice` |
| `UserStatusEnum` | `UserStatus.enum.ts` | `active`, `deleted`, `baned` (sic) |
| `PermissionEnum` (platform) | `permission.enum.ts` | `ban_user`, `ban_chat`, `manage_react` |
| `PermissionChatEnum` (chat) | `permissionChat.enum.ts` | `all`, `delete_message`, `change_info_chat`, `ban_user` |
| `AttachmentStatus` | `src/modules/attachments/enums/attachmentStatus.enum.ts` | `pending`, `attached` |

> Watch the typos: enum members keep code-level spellings (`groupe`, `baned`) and the seeded DB rows use the same strings — the client must match them exactly.

## Where values come from in the API

- `Chat.type` is a Postgres enum — appears as `"private" | "groupe" | "channel"` (raw `Chat` responses) — note `"groupe"`.
- `Message.type` is **not** an enum value in API output — it is a TypeMessage row (`{ id, name: 'text', … }`); use `.name`.
- `User.status` — raw enum string (`"active" | "baned"`).
- `Attachment.status` never appears in API-visible responses except semantically (pending → "only uploader may download"), while `attachments` inside messages are all `attached`.
- Platform role (`RoleEnum`) — JWT `{sub, role}` and `user.role.name` on `getme`.

## Seeded catalog rows (`src/modules/seeders/seeds/`)

| Table | Seeded values |
|---|---|
| `roles` | `owner`, `admin`, `user` (`role.seeder.ts`) |
| `role_chat` | `manager`, `admin`, `user`, `ban` (`roleChat.seeder.ts`) |
| `permissions` | `ban_user`, `ban_chat`, `manage_react` (`permission.seeder.ts`) |
| `permission_chats` | `all`, `ban_user`, `change_info_chat`, `delete_message` (`PermissionChat.seeder.ts`) |
| `type_messages` | `file`, `ice`, `image`, `text`, `video`, `voice` (`TypeMessage.seeder.ts`) |
| `reacts` | six defaults seeded idempotently: `thumbs_up` 👍, `heart` ❤️, `joy` 😂, `open_mouth` 😮, `cry` 😢, `pray` 🙏 (`react.seeder.ts`); admins manage the catalog via `/react` |

## Shared types (not user-facing, for reference)

- `{ sub: number, role: string }` — JWT payload (`src/common/types/jwt-payload.type.ts`).
- Branded ids (`src/common/types/brands.type.ts`): `ChatId`, `UserId`, `ProfileId`, `MessageId`, `ReactId`, `AttachmentId` — all plain `number` on the wire.
