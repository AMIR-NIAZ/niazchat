# Authentication

All authentication facts come from `src/modules/auth/controllers/auth.controller.ts`, `src/modules/auth/services/auth.service.ts`, `src/modules/auth/services/jwt.service.ts`, `src/modules/auth/services/otp.service.ts` and `src/common/guards/restGuards/payload.guard.ts`.

## Login flow: OTP via phone number

### 1. Request code — `POST /auth/send-otp`

- **Auth:** public (`@IsPublic()`), but guarded by `IsBanPhone` (`src/common/guards/restGuards/IsBanPhone.guard.ts`) which rejects (401) users whose `status === 'baned'`.
- **Body (`src/modules/auth/dtos/phone.dto.ts`):**

```json
{ "phone": "+989123456789" }
```

| Field | Validation |
|---|---|
| `phone` | `@IsPhoneNumber('IR')` — Iranian phone format **only** |

- **Rate limit:** if an OTP is already cached for the phone (TTL 60 s, `src/modules/auth/services/otp.service.ts#sendOtp`), returns:

```json
/** 429 */
{ "message": "code sent" }
```

- **Success:**

```json
/** 200 */
{ "message": "code send successfully" }
```

- OTP is dequeued by `OtpConsumer` → `MessageService.sendOtpCode` (`src/modules/auth/processor/otp.processor.ts`, `src/common/services/message.service.ts`), which currently just sleeps 5 s and logs — **no real SMS is sent**.
- In non-production (`PRODUCTION != 'true'`), the code is always `'00000'` (`src/modules/auth/services/otp.service.ts#generateOtp`).

### 2. Verify — `POST /auth/verify-otp`

- **Auth:** public.
- **Body (`src/modules/auth/dtos/verify.dto.ts`):**

```json
{ "phone": "+989123456789", "code": "00000" }
```

| Field | Validation |
|---|---|
| `phone` | `@IsPhoneNumber('IR')` |
| `code` | `@IsString()` (no length/min constraint) |

- **Success (creates the user on first login, `AuthService.submitUser`):**

```json
/** 200 */
{
  "message": "user logined successfull",
  "data": {
    "accessToken": "<jwt 1h>",
    "refreshToken": "<jwt 30d>"
  }
}
```

- **Errors:**
  - 404 `{ message: 'phone number not exit' }` — no pending OTP for that phone (expired or never requested; OTP TTL 60 s).
  - 400 `{ message: 'code not true' }` — wrong code (deleteMessage of `verifyOtp`).
  - 404 `role not found` — if seed data (`role.seeder.ts`) has not run.

### 3. Refresh — `POST /auth/refresh-token`

- **Auth:** public, but requires a **`token` header** (not `Authorization`, not Bearer) — see `AuthController.refreshToken`:

```http
POST /auth/refresh-token
token: <refreshToken>
```

- **Success:**

```json
{ "accessToken": "<new jwt 1h>" }
```

- **Errors:** 401 `UnauthorizedException` (invalid/expired refresh JWT) or 403 `ForbiddenException` (token does not match the stored hash in `users.refreshToken`). The bypass filter rewrites 403 message to `user not access`.

### Token semantics (`src/modules/auth/services/jwt.service.ts`)

| Token | Secret env | TTL | Payload |
|---|---|---|---|
| accessToken | `ACCESS_TOKEN_SECRET` | 1 h | `{ sub: number (user id), role: string }` |
| refreshToken | `REFRESH_TOKEN_SECRET` | 30 d | same |

- Refresh tokens are stored **hashed** on the user row (`AuthService.generateTokens`) and rotated is NOT performed — refresh returns only a new access token and does not reissue the refresh token.

## Request authentication

`PayloadGuard` is a global REST guard: every non-public route requires

```http
Authorization: Bearer <accessToken>
```

- Missing/malformed header → 401 `token not valid`.
- Expired/invalid JWT → 401.

## Roles (`src/common/enums/role.enum.ts`, `src/common/guards/restGuards/role.guard.ts` via `@Role([...])`)

- `owner` — everything, including all admin endpoints (implies every other role).
- `admin` — platform admin endpoints.
- `user` — after login every user gets role `user` (`AuthService.submitUser`).
- `all` — placeholder used on user-facing routes meaning "any authenticated role".

## Personal info

- `GET /auth/getme` (`@Role([RoleEnum.ALL])`) — returns the **bare user response**, **not** wrapped in `data` (see `AuthService.getme`). See [users.md](./users.md) for the shape.
- `PUT /auth/ban/:id` (`@Role([RoleEnum.ADMIN])`) — bans a platform user; response `{ message: 'user baned is <affected>' }`.

## Admin permission management (platform-level, `owner` only)

All in `AuthController` (`src/common/services/.../permission.service.ts`):

| Method / URL | Body / Notes |
|---|---|
| `POST /auth/users/:userId/admin` | `PermissionsDto` `{ permissions: PermissionEnum[] }` |
| `DELETE /auth/users/:userId/admin` | demote an admin |
| `GET /auth/admins` | `{ data: UserResponse[] }` |
| `PATCH /auth/admins/:adminId/permissions` | `PermissionsDto` |
| `GET /auth/admins/:adminId/permissions` | `{ data: Permission[] }` |

`PermissionEnum` (`src/common/enums/permission.enum.ts`): `ban_user`, `ban_chat`, `manage_react`.

## Mobile implementation notes

- Store `accessToken` in secure storage; refresh on any 401 using the `token` **header** (easy to get wrong — it is not `Authorization`).
- Once the access token expires (1 h) the only signal is the 401 from `PayloadGuard`; refresh and retry.
- If you log out, no backend endpoint invalidates tokens (`AuthService` has no logout) — client-side only.
