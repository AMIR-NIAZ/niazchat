# users feature

Profile & user lookup (docs/mobile-api/users.md). Not implemented yet — this is scope only.

## Endpoints
- `GET /auth/getme` — own profile (bare `toUserResponse`, no `data` wrapper).
- `GET /user/pv/:userName` — lookup by username (`{ data: UserResponse }`).
- `PUT /user/updateme` — name/username/biografy all required by validation.
- `PUT /user/uploade-avatar` (typo is canonical) — multipart field `avatar`.
- `DELETE /user/delete-avatar` — body `{ avatar: "<path>" }` (exact path from `avatars`).

## Notes
- `avatars` are server-relative paths → resolve via `absoluteUploadUrl()`.
- `isOnline`/`lastSeen` are broken server-side; do not build presence UI on them.
