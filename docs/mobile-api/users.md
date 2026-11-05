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

- `@Role([RoleEnum.ALL])`, multipart field **`avatar`** (`FileInterceptor` with `diskStorage` to `./uploads/avatars`, filename `Date.now()-<rand><ext>`).
- No size or content-type restrictions on this endpoint (`UserController.updateAvatar`).
- Appends the stored path to `profile.avatars`. Returns `{ message: 'avatar updated successfully' }`.

### `DELETE /user/delete-avatar`

- `@Role([RoleEnum.ALL])`. Body: `{ "avatar": "uploads/avatars/1700000000000-123.png" }` — exact path string from `avatars` array.
- Removes path from the array and deletes the file from disk (`UserService.deleteAvatar`).
- 404 if the path is not in the user's `avatars`.
- Returns `{ message: 'avatar updated successfully' }`.

## Internal behavior worth knowing

- `banUser` (admin) deletes the profile row and all avatar files (`AuthService.banUser`), so user lookup thereafter 404s.
- Every user gets an (empty) `user_profiles` row on first login (`AuthService.submitUser`), so `name` defaults to `'بدون نام'` in responses.
