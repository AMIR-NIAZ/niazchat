# Users & Profiles

Sources: `src/modules/auth/controllers/user.controller.ts`, `src/modules/auth/services/user.service.ts`, `src/modules/auth/utils/user-response.util.ts`.

## The canonical user response shape

`toUserResponse` (`src/modules/auth/utils/user-response.util.ts`) is what every user-facing payload actually returns (it merges `User` + `UserProfile`):

```ts
{
  id: number,              // users.id (bigint)
  createdAt: string,       // ISO timestamp (users)
  updatedAt: string,
  phone: string,
  name: string,            // profile.name ?? 'بدون نام'  (Persian "nameless")
  biografy: string | null, // profile.biografy ?? null
  username: string | null, // profile.username ?? null
  avatars: string[],       // profile.avatars ?? []  — file paths, not URLs
  isOnline: boolean,
  lastSeen: string | null, // timestamp or null
  status: 'active' | 'deleted' | 'baned',
  role?: { id, name, ... } // only present when role was loaded (getme)
}
```

> ⚠️ `avatars` are **server-relative file paths** such as `uploads/avatars/1700000000000-123.png`. The static file server exposes them at `/uploads/avatars/...` (ServeStaticModule, `src/modules/app/app.module.ts`). The client must prepend the host; the backend never returns a full URL.
>
> The stored path already contains the `uploads/` mount segment, so the mount must not be added twice: a client whose base is `http://host:3000/uploads` has to strip the leading `uploads/` (mobile: `absoluteUploadUrl()` in `core/config/env.ts`).
>
> **`avatars[0]` is the current photo** everywhere (profile, message `sender.avatars`, other user payloads). A user may keep up to **10** photos. On the wire an individual photo is identified by its stored **file name** (basename), never by array index and never by a client-supplied path.
>
> On **message** payloads `sender` is deliberately reduced to `{ id, name, username, avatars }`, with `avatars` holding at most the current photo (`[path]` or `[]`). Phone, `lastSeen`, `isOnline`, `status`, `biografy` and `role` are never included in a room broadcast (see `messages.md`).

## Thumbnails (`GET /media/avatars/:size/:fileName`)

Small circles (chat list, message bubbles, headers, profile tiles) must use this route, not the original file.

- **Public** (same visibility as `/uploads`: static originals are served by middleware, outside the guards), so no `Authorization` header is needed.
- `:size` is a closed allowlist: `64`, `128`, `256`. Anything else → `400 { message: "size must be one of 64, 128, 256" }`.
- `:fileName` is the stored file **name** (basename), e.g. `1712345678901-123.png`. Path-shaped input (`../x.png`, `a/b.png`), `..` and non-image extensions are rejected with `400` before any filesystem access; a name that is not in `uploads/avatars` → `404`.
- The image is generated on demand with `sharp` (EXIF-rotated, square `cover` crop, WebP quality 75, metadata stripped), cached on disk at `uploads/thumbs/<size>/<fileName>.webp`, deduplicated in flight and written atomically. Later requests are served from disk.
- Headers: `Cache-Control: public, max-age=31536000, immutable`, `ETag`, `Last-Modified`, `Content-Type: image/webp` (conditional request with `If-None-Match` → `304`). `X-Avatar-Thumbnail: generated|hit` is diagnostic only.
- Originals under `/uploads/**` now also carry `Cache-Control: public, max-age=31536000, immutable` — file names are unique per upload, so a changed photo always has a new URL. The full-size original is still what the profile photo viewer loads.
- Deleting a photo deletes its cached thumbnails for every size (best effort, also for group photos that share `uploads/avatars`).

## Endpoints

### `GET /auth/getme`

- `@Role([RoleEnum.ALL])`. Returns the bare object above **without** a `data` wrapper (unlike `getUserByUsername`, which wraps in `data`). Source: `AuthService.getme` (`src/modules/auth/services/auth.service.ts`).

### `GET /user/pv/:userName`

- Lookup by username. `@Role([RoleEnum.ALL])`. Source: `UserService.getUserByUsername` (`src/modules/auth/services/user.service.ts`).
- **Response is wrapped:** `{ data: toUserResponse(...) }`.
- 404 `{ message: 'user not found' }` if unknown username.
- Note: `role` is absent here (not selected).

### `GET /user/:userId/profile` — public profile of any user

- Auth: authenticated users only (global guard → `401` without a token). **No** shared-chat or role requirement: any user may view any other user.
- `:userId` is a **positive integer**; `ParseIntPipe` + the service answer `400 { message: ... }` for `abc`, `0`, `-1`, `1.5`.
- Response is the dedicated public projection (NOT `toUserResponse`), **bare** (no `data` wrapper):

```json
{
  "id": 42,
  "name": "Sara",
  "username": "sara_1990",
  "biografy": "hello",
  "avatars": ["uploads/avatars/current.png", "uploads/avatars/second.png"],
  "isOnline": true,
  "lastSeen": "2026-02-01T10:00:00.000Z"
}
```

- `avatars` holds **all** photos with the current one first (`avatars[0]`), as server-relative paths. `phone`, `refreshToken`, `status`, `role` and the timestamps are **never** included — the serializer is a whitelist (`src/modules/auth/utils/public-profile.util.ts`).
- A non-existent id **and** a user whose `status` is not `active` (`baned`, `deleted`) both return `404 { message: 'User not found' }` — never `403`, so the route cannot be used to probe account state.
- Headers: `Cache-Control: private, max-age=30`, `Vary: Authorization`; Express adds a weak `ETag` and answers `304` for a matching `If-None-Match`.
- No rate limiter is installed in this project (`@nestjs/throttler` absent), so no `429` is produced by this endpoint.

### `PUT /user/updateme`

- `@Role([RoleEnum.ALL])`. Updates the caller's profile (`UserService.updateUser`).
- Body (`src/modules/auth/dtos/updateUser.dto.ts`) — **all three fields are required by validation (`forbidNonWhitelisted` + no `@IsOptional`), despite the service updating them conditionally:**

```json
{
  "name": "نام یا متن تا ۲۰ کاراکتر",     // MaxLength(20)
  "username": "my_username",              // MinLength(5), MaxLength(32), /^[a-zA-Z][a-zA-Z0-9_]*[a-zA-Z0-9]$/
  "biografy": "متنی تا ۱۰۰ کاراکتر"       // MaxLength(100)
}
```

- Success: `{ message: 'user updated is 1' }`.
- Errors: 409 `{ message: 'username already exists' }` (unique violation `23505` handled in `UserService.isUniqueViolation`); 400 validation errors.

### `POST /user/avatars` — add a photo

- `@Role([RoleEnum.ALL])` (authenticated users only, own profile only). Multipart field **`avatar`** (`AvatarUploadInterceptor` → `diskStorage` in `uploads/avatars`, server-generated `${randomUUID()}.<ext>`; the directory is created at boot).
- **Images only**: `image/jpeg`, `image/png`, `image/webp`. The interceptor filters the declared MIME, and the service sniffs the bytes (`detectFileMimeType`) and rejects a mismatch. Max size **5 MiB** (`AVATAR_MAX_FILE_SIZE`).
- **Max 10 photos**; the 11th upload is rejected with `400` before the file is stored (`AvatarLimitGuard`). The limit is re-checked inside the same transaction as the array write, so concurrent uploads cannot exceed it.
- The new photo is **prepended** as `avatars[0]` (the current one); existing photos keep their order. Returns the updated user:

```json
{
  "message": "avatar added successfully",
  "user": { "id": 11, "avatars": ["uploads/avatars/<new>.png", "uploads/avatars/<older>.png"], "...": "<UserResponse>" }
}
```

- Errors: `400` (missing field, wrong type, content is not an image, limit reached — the message is specific and safe to show), `413` (file too large), `401` (missing/expired token).
- The upload is only confirmed once this payload arrives — clients should refresh/seed their current-user cache from `user` instead of assuming success. If the DB write fails the stored file is removed again.

### `DELETE /user/avatars/:fileName` — remove one photo

- `@Role([RoleEnum.ALL])`. `:fileName` is the stored file **name** (`<uuid>.png`), not the path. It must match an entry in the caller's own `avatars` by basename; anything else is `404` (`avatar not found`) or `400` (`invalid avatar file name` for path-shaped input such as `../../x`).
- The filesystem path is always rebuilt from the matched stored entry inside `uploads/avatars` (path-traversal protection), never from the raw param. The file is deleted best effort (a disk error is logged and never fails the request).
- Removing the current photo automatically promotes the next one; removing the last leaves `avatars: []` (clients show initials/placeholder).
- Returns the updated user: `{ "message": "avatar deleted successfully", "user": { ...<UserResponse> } }`.

### `PUT /user/avatars/:fileName/main` — set the current photo

- Same ownership/name validation as delete. Moves that photo to `avatars[0]`, keeping the relative order of the others (single SQL `array_prepend(entry, array_remove(avatars, entry))` under a row lock).
- Returns `{ "message": "current avatar updated successfully", "user": { ...<UserResponse> } }`.
- Other users see the new current photo through the usual payloads (`sender.avatars` in messages, user lookups) on their next fetch; there is no dedicated socket event for avatar changes.

### `PUT /user/uploade-avatar` *(legacy upload route — typo is canonical)*

- Kept for old clients. Same behavior as `POST /user/avatars`: multipart field `avatar`, same validation/limits, **prepends** the stored path and returns `{ message: 'avatar added successfully', user }`.
- Request/response stay compatible with older builds (previous photos are kept instead of replaced). Note: a build that displayed the **last** array entry as current (the pre-multi-avatar app) will show the oldest photo after this change; the canonical convention is index 0, which is what every other consumer already used.

### `DELETE /user/delete-avatar` *(legacy)*

- Kept for old clients. Body: `{ "avatar": "uploads/avatars/<name>.png" }` — the **exact stored path** from `avatars` (not the file name).
- Removes that path from the array and deletes its file; `404` if the exact path is not in the caller's `avatars`.
- Returns `{ message: 'avatar updated successfully' }` (unchanged legacy shape, no `user`).

## Internal behavior worth knowing

- `banUser` (admin) deletes the profile row and all avatar files (`AuthService.banUser`), so user lookup thereafter 404s.
- Every user gets an (empty) `user_profiles` row on first login (`AuthService.submitUser`), so `name` defaults to `'بدون نام'` in responses.
