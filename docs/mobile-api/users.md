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

## Endpoints

### `GET /auth/getme`

- `@Role([RoleEnum.ALL])`. Returns the bare object above **without** a `data` wrapper (unlike `getUserByUsername`, which wraps in `data`). Source: `AuthService.getme` (`src/modules/auth/services/auth.service.ts`).

### `GET /user/pv/:userName`

- Lookup by username. `@Role([RoleEnum.ALL])`. Source: `UserService.getUserByUsername` (`src/modules/auth/services/user.service.ts`).
- **Response is wrapped:** `{ data: toUserResponse(...) }`.
- 404 `{ message: 'user not found' }` if unknown username.
- Note: `role` is absent here (not selected).

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

### `PUT /user/uploade-avatar`  *(typo is in the real route — do NOT "fix" it in the client)*

- `@Role([RoleEnum.ALL])`, multipart field **`avatar`** (`AvatarUploadInterceptor` → `diskStorage` in `uploads/avatars`, filename `<timestamp>-<rand>.<ext>`; the directory is created at boot).
- **Images only**: the declared MIME must be jpeg/png/gif/webp, and the stored bytes are sniffed again (`detectFileMimeType`) so a renamed non-image is deleted and rejected. `UPLOAD_MAX_FILE_SIZE` (default 10 MiB) caps the size.
- Errors: `400` (missing field, wrong type, content is not an image — the message is specific and safe to show), `413` (file too large), `401` (missing/expired token).
- Appends the stored path (`uploads/avatars/...`, forward slashes) to `profile.avatars` and returns the updated profile:

```json
{
  "message": "avatar updated successfully",
  "user": { "id": 11, "avatars": ["uploads/avatars/1700000000000-123.png"], "...": "<UserResponse>" }
}
```

The upload is only confirmed once this payload arrives — clients should refresh/seed their current-user cache from `user` instead of assuming success.

### `DELETE /user/delete-avatar`

- `@Role([RoleEnum.ALL])`. Body: `{ "avatar": "uploads/avatars/1700000000000-123.png" }` — exact path string from `avatars` array.
- Removes path from the array and deletes the file from disk (`UserService.deleteAvatar`).
- 404 if the path is not in the user's `avatars`.
- Returns `{ message: 'avatar updated successfully' }`.

## Internal behavior worth knowing

- `banUser` (admin) deletes the profile row and all avatar files (`AuthService.banUser`), so user lookup thereafter 404s.
- Every user gets an (empty) `user_profiles` row on first login (`AuthService.submitUser`), so `name` defaults to `'بدون نام'` in responses.
