# attachments feature

File lifecycle (docs/mobile-api/attachments.md). Not implemented yet — scope only.

## Chat attachments (message files)
- Upload: `POST /chats/:chatId/attachments` — multipart field **`file`**, Bearer auth, ≤10 MiB, allowlisted types.
- Response: `AttachmentUploadResponse` (`id`, …). Attachments are single-use: `pending` until bound to a message via `sendMessage` `attachments: [id]` (same chat only).
- Download: `GET /attachments/:id/download` — streamed, forced `attachment` disposition; fetch with Bearer header and persist locally (e.g. expo-file-system), no inline rendering.

## Avatars (different mechanism)
- Upload via `PUT /user/uploade-avatar` (field `avatar`); served statically, unauthenticated, under `/uploads`.
