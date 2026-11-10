# Attachments

Sources: `src/modules/attachments/*`, `src/modules/messages/dtos/createMessage.dto.ts`, `message.service.ts`, `src/common/utils/ws-serializer.utils.ts`.

Two separately-scoped concepts:
- **Chat attachments** (files attached to messages) — HTTP upload, WebSocket message, authorized download/preview by id only.
- **Avatars** (user/chat avatars) — simple multipart upload, served statically from `/uploads`.

## Architecture

The **file** travels over HTTP (`POST /chats/:chatId/attachments` → attachment ids); the **message** travels over the WebSocket (`sendMessage` with `attachments: [id]`). Files never go through the socket (`maxHttpBufferSize` is 1 MB).

## Limits (shared constants)

| Limit | Value |
|---|---|
| Attachments per message | 10 |
| Image/file size | 20 MiB (`20 * 1024 * 1024`) |
| Video size | 100 MiB |
| Voice size | 15 MiB (one voice per message) |
| Voice duration | 10 min (server tolerates 11 min of container duration) |
| Total per message / upload request | 200 MiB |
| Concurrent upload requests per user | 3 (429 above) |
| Video concurrency in the app | 1 at a time (images/files stay at 3) |
| Media processes on the server | 2 ffmpeg/ffprobe at a time |
| Unsent (pending) attachment TTL | 6 h |
| Files of a soft-deleted message | removed after 24 h |

Backend: `src/modules/attachments/attachment.constants.ts`. App: `mobile/src/features/attachments/constants.ts`.

## Upload — `POST /chats/:chatId/attachments`

- Guards: global `PayloadGuard` (Bearer) + `@Role([RoleEnum.ALL])` + `IsBanMember` (member, not `ban`). The service additionally rejects a banned **chat** (`isBan`, 400 `chat is banned`).
- `multipart/form-data`, field **`files`** (up to 10). The legacy single field **`file`** is still accepted.
- Optional text field **`voice=1`**: uploads exactly one file as a voice message. It must be appended **before** the file part (multer only exposes text fields that precede files), but the server decides after the upload finished — a request with the file first and `voice` later still produces `kind: "voice"`. Without the field an audio file stays `kind: "file"`.
- **Disk storage** (never memory): multer writes to a unique temp directory; the service moves validated files to their final key. An aborted or failed request leaves no temp files and no row.
- HTTP request/header timeouts are raised to 15 minutes for large video uploads.

**Success (201):**

```json
{
  "ok": true,
  "data": [
    {
      "id": 12,
      "originalName": "گزارش.pdf",
      "mimeType": "application/pdf",
      "size": 20543,
      "kind": "file"
    },
    {
      "id": 13,
      "originalName": "photo.png",
      "mimeType": "image/png",
      "size": 51200,
      "kind": "image",
      "width": 1280,
      "height": 960
    },
    {
      "id": 14,
      "originalName": "clip.mp4",
      "mimeType": "video/mp4",
      "size": 7340032,
      "kind": "video",
      "width": 1280,
      "height": 720,
      "duration": 12.3,
      "hasPoster": true
    },
    {
      "id": 15,
      "originalName": "voice-1760000000000.m4a",
      "mimeType": "audio/mp4",
      "size": 48120,
      "kind": "voice",
      "duration": 7.4,
      "waveform": [0, 12, 45, 81, 64, 30, 8, 0]
    }
  ]
}
```

`width`/`height` are persisted for new images and videos; `duration` and `hasPoster` are video-only; `duration` and `waveform` (64 integers `0..100`, or absent) are voice-only. Storage paths/keys are never returned.

### Validation & storage

- Name: last path segment only, control/path characters stripped, max **200** chars. Multipart names decoded as latin1 are re-decoded as UTF-8 (Persian/Unicode names arrive intact).
- Extension allowlist: images `jpg jpeg png webp gif`; documents `pdf doc docx xls xlsx ppt pptx txt csv md rtf`; archives `zip rar 7z tar gz`; audio `mp3 wav ogg m4a opus`; video `mp4 m4v mov webm mkv avi`. Blocked with a clear 400 even if allowlisted elsewhere: `exe bat cmd com scr msi sh bash apk jar js mjs cjs vbs ps1 dll app deb rpm bin iso`.
- `kind: "image"` **only** when `sharp` decodes real pixels (`limitInputPixels: 40_000_000`) into jpeg/png/webp/gif. A text file renamed `.png` is **rejected** with 400 `file content is not a valid image`.
- Video detection is content-based with `ffprobe -show_streams -show_format`: accepted containers are exactly **MP4 / M4V / MOV / WebM**; the file must contain a real video stream (codec type `video`, not `disposition.attached_pic`), with positive finite duration and dimensions. Audio-only files (including audio with cover art) and `mkv`/`avi` stay `kind: "file"`. A file that ffprobe cannot parse is rejected with 400 `This file is not a valid video`; absurd values (dimension > 8192 px, duration > 2 h) are rejected with a clear 400.
- Rotation is applied to `width`/`height` using `tags.rotate` and display-matrix side data (swapped for 90/270). `duration` is stored to one decimal.
- Voice (`voice=1`): exactly one file, ≤15 MiB (413 above, file removed), verified by `ffprobe` as an **audio** stream with no real video stream (cover art with `disposition.attached_pic` is ignored), positive finite duration ≤11 min. Accepted containers/codecs: MP4/M4A (AAC), MP3, OGG/Opus, WebM/Opus. Client MIME/extension is never trusted; anything else → 400 `This file is not a valid voice recording` (over 11 min → 400 `voice recording is longer than 10 minutes`). The stored MIME becomes the detected `audio/mp4 | audio/mpeg | audio/ogg | audio/webm`.
- Voice waveform: ffmpeg decodes to mono 8 kHz s16le PCM on stdout (streamed, never the whole file), split into 64 equal-time buckets, RMS per bucket, `sqrt`-compressed against the clip's own peak → integers `0..100` (silence stays near 0). Generation failure accepts the voice with `waveform: null` (the app draws flat bars) and logs a warning. Validation/abort failures leave no file and no row.
- If `ffprobe` is missing at boot a warning is logged; video uploads fail with **503** `Video processing is unavailable` and voice uploads with **503** `Audio processing is unavailable`; no unplayable file is stored.
- Poster: one frame at `min(1 s, duration/2)`, downscaled to ≤1280 px, re-encoded as WebP (quality 75) and stored next to the attachment. A poster failure does not reject the video (`hasPoster: false`); the app shows a placeholder.
- Storage: `<STORAGE_DIR>/attachments/<chatId>/<uuid>.<ext>` plus `<chatId>/<uuid>.poster.webp`, outside any static path, server-generated names only.
- Compensating cleanup: a later failure in the same request removes already-written files/posters; a failed DB insert removes every file.
- On success rows are `status: 'pending'`, with uploader, chat and `createdAt`; they can only be sent in that chat.

**Errors:** 401 unauthenticated; 403/404 not a member; 403 `user cant access` for the `ban` role; 413 file/request too large (`file exceeds…`, `files exceed the maximum message size…`); 400 too many files, empty file, blocked/disallowed type, invalid image/video, banned chat; 429 too many concurrent uploads; 503 video processing unavailable; 500 storage failure.

## Message wiring

`sendMessage` payload additions (`CreateMessageDto`):

```json
{
  "chatId": 42,
  "content": "",              // optional when attachments are present
  "attachments": [12, 13, 14],// 1..10, unique positive integers
  "clientMessageId": "c_lz3k_9f2" // optional: 1..64 of A-Z a-z 0-9 _ -
}
```

- A message needs text **or** ≥1 attachment; neither → 400 `message needs text or at least one attachment`.
- Inside the message transaction, each attachment must exist, be uploaded by the sender, belong to the same chat, still be `pending`, and the combined size must be ≤200 MiB. The conditional `status: 'pending' → 'attached'` update means two concurrent sends cannot claim the same id: one succeeds, the other gets `attachment already used` and the whole message rolls back.
- A message may mix images, videos and files. **Voice is never mixed**: when any attachment is `voice`, the message must have exactly one attachment and empty/absent text, otherwise the transaction rejects with `a voice message must have exactly one attachment` or `voice messages cannot include text` and nothing is attached.
- `clientMessageId` is **not persisted**: it is echoed on the room event and the ack `data` so the app can match its optimistic bubble (works for empty captions and two identical photos). History pages do not carry it.
- Reply previews gain `attachmentsCount`, `attachmentKind` (`"image" | "video" | "voice" | "file" | null`) and `attachmentDuration` (voice/video first attachment).
- Attachment wire objects carry `kind: "voice"`, `duration` and `waveform: number[] | null` for voice rows. Chat-list `lastMessage.attachments` carries `kind` and `duration` too.

## Download — `GET /attachments/:id/download`

Accepts either a normal Bearer header **or** a short-lived signed URL (`uid`, `exp`, `sig`; see below).

Authorization (one 404 for every failure, so existence is not leaked):
- attachment must exist;
- pending (unsent) → only its uploader;
- attached → caller must be a non-banned member of the attachment's chat, the chat must not be banned, and the message must not be soft-deleted.

Headers:

| Header | Value |
|---|---|
| `Content-Type` | verified MIME for images/videos (`video/mp4`, `video/quicktime`, `video/webm`) and voice (`audio/mp4`, `audio/mpeg`, `audio/ogg`, `audio/webm`); `application/octet-stream` for files |
| `Content-Disposition` | `inline` for images, videos and voice (`attachment` for `?download=1` on videos) / `attachment` for files; `filename="<ASCII fallback>"; filename*=UTF-8''<encoded>` |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `private, max-age=31536000, immutable` (ids never reused) |
| `ETag` / `Last-Modified` | conditional requests → `304`; `If-Range` honours both |
| `Accept-Ranges` | `bytes` |

Range behavior: single `bytes=a-b`, open-ended `bytes=a-` and suffix `bytes=-n` → `206 Partial Content` with `Content-Range` and an exact `Content-Length`; invalid/unsatisfiable → `416` with `Content-Range: bytes */<size>`; **multi-range requests are ignored** and answered with the full `200`; an `If-Range` mismatch also returns the full `200`. Files are streamed with `fs.createReadStream({ start, end })` and the stream is destroyed when the client disconnects.

### Signed stream URL — `POST /attachments/:id/stream-url`

Authenticated, videos only. Returns:

```json
{ "ok": true, "data": { "url": "http://host/attachments/14/download?uid=7&exp=1760000000&sig=…", "expiresAt": "2026-…" } }
```

- `sig` = HMAC-SHA256 over `<attachmentId>:<userId>:<exp>` with `ATTACHMENT_STREAM_SECRET` (never a JWT or the access token), expiry 10 minutes, compared in constant time.
- The signed URL authorizes **only** `GET /attachments/:id/download` for that attachment/user. Membership/ban/deleted checks still run.
- Used by the app because video players do not reliably forward Bearer headers on both platforms.

## Preview — `GET /attachments/:id/preview?size=320|640|1280`

- Same auth; images and videos. Default `640`; any other size → 400.
- Images: resized WebP (`fit: inside`, aspect kept, `rotate()` for EXIF, metadata stripped), generated on demand, cached at `<STORAGE_DIR>/attachment-previews/<size>/<storageKey>.webp`, deduplicated in flight and written atomically.
- Animated GIFs are served as the original GIF (re-encoding would drop the animation).
- Videos: the stored poster is resized/cached the same way (`<storageKey>.poster.webp`). A video without a poster returns **404** and the app renders its placeholder.
- Same immutable/private cache and conditional headers as download.

## Wire shape

Message attachments include:

```ts
{
  id, originalName, mimeType, size,
  kind: 'image' | 'video' | 'voice' | 'file',
  width?, height?,          // when known (new images/videos)
  duration?, hasPoster?,    // duration: videos + voice; hasPoster: videos
  waveform?,                // voice only: 64 integers 0..100, or null
  createdAt                 // message payloads (not chat-list previews)
}
```

The internal `posterPath` column is never exposed; `hasPoster` is derived from it. Chat-list `lastMessage.attachments` uses the same shape (minus `createdAt`).

## Cleanup

No `@nestjs/schedule` dependency: `AttachmentCleanupService` runs every 30 min (`ATTACHMENT_CLEANUP_INTERVAL_MS`) with an overlap guard, started in `onModuleInit` and cleared in `onModuleDestroy`.

- Pending attachments older than `ATTACHMENT_ORPHAN_TTL_MS` (default 6 h): row + file + poster + previews deleted.
- Attachments of messages soft-deleted before `ATTACHMENT_DELETED_TTL_MS` (default 24 h): row + file + poster + previews deleted.
- File deletion failures are logged, never thrown.

## Docker

`ffmpeg` (which includes `ffprobe`) is installed in both backend images. `STORAGE_DIR` (default `./storage`) is mounted as the `storage_data` volume in `docker-compose.dev.yml`, so attachments and posters survive container recreation. Rebuild after the image change:

```bash
docker compose -f docker-compose.dev.yml build app
docker compose -f docker-compose.dev.yml up -d --force-recreate app
```

No npm dependency was added for media processing, so the `niazchat-dev_node_modules_dev` volume does **not** need to be removed.

## Avatars (different mechanism)

- Upload = multipart (`POST /user/avatars` field `avatar`, legacy `PUT /user/uploade-avatar`; `POST /chats/manage/upload/avatar/:chatId` field `avatar`) → `uploads/avatars`.
- Served **statically** under `/uploads` by `ServeStaticModule` — no auth. Deletion goes through REST per `users.md`/`chats.md`.
