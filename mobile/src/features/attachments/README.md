# attachments feature

Files (photos and documents) in chat. The **file** goes over HTTP, the
**message** over the WebSocket. Backend contract: `docs/mobile-api/attachments.md`.

## Flow

1. **Pick** — composer "+" → Photos (`expo-image-picker`, multi-select), Camera
   (permission + Settings link) or File (`expo-document-picker`, copied to the
   cache). Selected items live in a tray above the input; the input is the
   caption. Validation mirrors the server (`validation.ts`).
2. **Optimistic send** — `use-chat-messages` inserts a pending bubble with
   local previews and a generated `clientMessageId`, then uploads with at most
   **3** concurrent XHR requests (`attachment-upload.ts`) because React Native
   `fetch` has no upload progress. Bearer token comes from the shared provider;
   a 401 refreshes once and retries.
3. **Message** — once every file has an id, `sendMessage` is emitted with
   `{ attachments: [ids], clientMessageId, content }`. The ack and the room echo
   both carry `clientMessageId`, so `mergeMessages` consumes exactly the right
   pending bubble (empty captions and two identical photos included).
4. **Render** — images inline (`AttachmentGrid`, preview route, auth header,
   `memory-disk` cache with a stable per-attachment `cacheKey`, tap → full-screen
   viewer); documents as rows
   (`AttachmentFileRow`). A document tap downloads to
   `<cache>/files/<attachmentId>/<sanitized original name>` (temp file then
   rename), then opens it: Android uses a `content://` URI + ACTION_VIEW intent
   (`expo-intent-launcher`, read-permission flag); iOS uses the share sheet
   because no QuickLook module is installed. A separate row button always
   shares via `expo-sharing`. Re-tapping a cached file opens it offline.
5. **Failures** — per-file failures stay on that file; Retry re-uploads only
   failed files and reuses the ids that already succeeded. Cancel aborts the
   uploads and removes the bubble. A socket failure keeps the uploaded ids
   (valid during the 6 h orphan window) so Retry only resends.

## Media cache (images and videos)

Full-size images opened in the viewer and videos that finished downloading live
under the app's **documents** directory (not the OS-purgeable cache):

```
media-cache/
  index.json            attachmentId -> { path, size, lastAccessedAt }
  images/<id>.<ext>     full-size images the user opened
  videos/<id>.<ext>     completely downloaded videos
```

Downloads go to `<final>.part` and are renamed only after a clean, non-empty
download, so a partial file is never used. The index is LRU-ordered and capped
at `MAX_MEDIA_CACHE_BYTES` (500 MB, never evicting the video playing); leftover
`.part` files are removed on app start. There is NO streaming: a video plays
only after it is fully downloaded and its byte size verified (Telegram-style).
The bubble shows a download button + size; a ready video shows play and opens
the viewer, which plays the local file (offline included). Bubble thumbnails
keep using expo-image's cache with `att-<id>-thumb`; the viewer poster uses
`att-<id>-poster`.

## Voice messages

See `../voice/`. A voice message is one attachment with `kind: 'voice'`, empty
text, ≤15 MB and ≤10 minutes (server tolerates 11). The composer shows a mic
when there is no text/selection: tap starts the recording bar, holding ~250 ms
records until release (slide left cancels, slide up locks). Clips under 1 s are
discarded, 10 minutes auto-stops into a draft (play/send/delete). The recorder
uses `expo-audio` (AAC/M4A, mono, 48 kbps, 44.1 kHz) and metering peaks for the
bubble waveform.

The optimistic bubble is created immediately with a `clientMessageId`; the file
is uploaded with `voice=1` **before** the file part, then `sendMessage` carries
its id. The bubble downloads the complete file to `<cache>/voice/` with the
Bearer header (refresh once on 401), plays from disk, and caps the cache at
100 files / 100 MB (oldest evicted). Playback is a single module-level player
(one active voice, speed 1x/1.5x/2x, seek, waveform progress).

Voice messages cannot be edited and are never rendered as generic file rows.

## Constants (mirrored from the backend)

| Limit              | Value                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Files per message  | 10                                                                                                     |
| File size          | 20 MB                                                                                                  |
| Message size       | 60 MB                                                                                                  |
| Concurrent uploads | 3                                                                                                      |
| Blocked extensions | exe, bat, cmd, com, scr, msi, sh, bash, apk, jar, js, mjs, cjs, vbs, ps1, dll, app, deb, rpm, bin, iso |

## Key files

- `constants.ts` — limits; `attachment-url.ts` — the only URL builder.
- `auth-headers.ts` — fresh `Authorization` for expo-image/downloads + refresh.
- `attachment-upload.ts` — XHR upload and bounded concurrency.
- `upload-progress-store.ts` — progress outside the Query cache (10 ticks/s).
- `file-download.ts` — named per-id cache, 401 refresh, atomic rename, share.
- `file-name.ts` — Unicode-safe name sanitization, MIME/UTI/type labels.
- `file-cache-policy.ts` — 200-file / 300-MB document cache eviction.
- `file-open-policy.ts` / `open-file.ts` — Android intent vs iOS share decisions.
- `attachment-grid.tsx` / `attachment-file-row.tsx` / `attachment-viewer.tsx`.
- `../shared/media-cache/` — persistent image/video cache, LRU index, startup cleanup.

Long-press on a tile, voice control/waveform/time, document row or its share
button is forwarded to the message bubble's action sheet; short taps keep
their viewer/play/seek/open behavior.

## Packages

Installed with `npx expo install`: `expo-document-picker`, `expo-file-system`,
`expo-sharing`, `expo-intent-launcher`. `expo-image-picker` was already present.
These are native modules: a **development rebuild** (`npx expo run:ios|android`
or an EAS dev build) is required. `expo-image-manipulator` is deliberately NOT used
(downscaling/HEIC conversion is not done on the client; the server is the
authority).
