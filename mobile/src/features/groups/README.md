# groups feature

Group/member management under `/chats/manage/*` (docs/mobile-api/groups.md). Not implemented yet — scope only.

## Highlights
- All routes guarded by `ManagerChatGuard` (chat role `manager`, or chat `admin` with the required `permission_chat`).
- Add member by **phone**: `POST /chats/manage/:groupId/add/:userPhone`.
- Ban/unban: `POST /chats/manage/:memberId/ban`, `.../onban/:memberId`; banned list `GET /chats/manage/:chatId/bans`.
- Chat avatar upload/delete (permission `change_info_chat`).
- Invite links: `POST /chats/manage/:chatId/link`, list, deactivate (creation likely broken server-side: 32-char code vs 20-char column).
- Promote/demote chat admins; per-admin permissions (`add permission` path is broken server-side).

## Known gaps
- No member list, leave-group, remove-member, or rename-title endpoint exists anywhere.
