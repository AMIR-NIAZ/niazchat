# Attachments

Sources: `src/modules/attachments/controllers/attachments.controller.ts`, `services/attachment.service.ts`, `attachment.config.ts`, `interceptors/upload-file.interceptor.ts`, `utils/file-signature.util.ts`, `entities/attachment.entity.ts`, `enums/attachmentStatus.enum.ts`.

Two separately-scoped concepts:
- **Chat attachments** (files attached to messages) — secure, validated, authorized-by-id only.
- **Avatars** (user/chat avatars) — simple multipart CSV-export style, served statically from `/uploads`.

## Chat attachment upload — `POST /chats/:chatId/attachments`

- Guard chain: global `PayloadGuard` (Bearer token) + `@Role([RoleEnum.ALL])` + `IsBanMember` (reads `:chatId` from route params; 404 if not a member, 403 if role is `ban`).
- Multipart field name: **`file`** (`UploadFileInterceptor` → `FileInterceptor('file')`).
- Method must be multipart (`POST`); memory storage, no temp file.

**Response (class `AttachmentUploadResponse`):**

```json
/** 201 */
{
  "id": 12,
  "originalName": "photo.png",
  "mimeType": "image/png",
  "size": 20543,
  "chatId": 42,
  "createdAt": "2026-11-02T..."
}
```

**Config (`AttachmentConfig`):**

| Env | Default | Meaning |
|---|---|---|
| `UPLOAD_MAX_FILE_SIZE` | `10485760` (10 MiB) | exact byte cap, checked both by Multer limit and by the service |
| `UPLOAD_ALLOWED_EXTENSIONS` | `jpg,jpeg,png,gif,webp,pdf,mp4,mp3,txt` | drives the MIME allowlist |
| `STORAGE_DIR` | `./storage` | real dir is `<STORAGE_DIR>/attachments` |

Errors (all 400 unless noted): missing or empty file `file is required`; size cap: `file exceeds the maximum allowed size of …`; disallowed type `file type is not allowed`; mismatch `file content does not match its declared type` (magic-byte sniffing, `detectFileMimeType`); 500 on storage/db failure.

**Semantics:** the file count row is inserted with `status: 'pending'`, chat-bound; can only be sent in that chat (`findUsable` → 403 for wrong uploader, 400 `attachment does not belong to this chat`, 400 `attachment already used`).

## Message wiring

In `CreateMessageDto.send`, `"attachments": [12, 13]` → service `persistMessage` wraps insert + bind in a single transaction:

- `bindToMessage` updates `status: 'pending' → 'attached'` with a status guard, so the same attachment cannot be reused; if fewer rows were updated than ids given → `BadRequestException('attachment already used')` and the whole message insert rolls back.

**No cleanup job exists** — unknown-task orphan pending attachments stay on disk (`pendingMessageCleanup` not implemented). Flagged in the summary.

## Chat attachment download — `GET /attachments/:id/download`

- `@Role([RoleEnum.ALL])` (global Bearer auth).
- Streams the file. Authorization (`assertReadableBy`):
  - `status === 'pending'` → only the uploader may read.
  - `status === 'attached'` → any non-banned member of the attachment's chat.
  - Failure → 403 (`user not access` after filter rewrite), missing file → 404 `attachment not found`.
- Response headers are set explicitly:

| Header | Value |
|---|---|
| `Content-Disposition` | `attachment; filename*=UTF-8''<encoded originalName>` — **always** download, never inline |
| `Content-Type` | stored mimeType |
| `Content-Length` | stored size |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `private, no-store` |

Mobile note: on RN you cannot rely on the browser download behavior — fetch with the Bearer header and stream to the cache (e.g. `react-native-blob-util` or `expo-file-system`) to save the file locally.

## Avatars (user & chat) — different, simpler mechanism

- Upload = multipart (`POST /user/avatars` field `avatar`, legacy `PUT /user/uploade-avatar`; `POST /chats/manage/upload/avatar/:chatId` field `avatar`) → stores under `uploads/avatars`.
- Served **statically** by `ServeStaticModule` under **`/uploads`** (`src/modules/app/app.module.ts`) — no auth on these URLs. Deletion goes through REST per `users.md`/`chats.md`.
- Paths in the JSON (e.g. `uploads/avatars/…`) need prefixing with the host URL by the mobile client (they aren't absolute URLs).
