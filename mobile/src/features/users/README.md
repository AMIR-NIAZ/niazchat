# users feature

Profile & user lookup (docs/mobile-api/users.md). Not implemented yet — this is scope only.

## Endpoints
- `GET /auth/getme` — own profile (bare `toUserResponse`, no `data` wrapper).
- `GET /user/pv/:userName` — lookup by username (`{ data: UserResponse }`).
- `PUT /user/updateme` — name/username/biografy all required by validation.
- `PUT /user/uploade-avatar` (typo is canonical) — multipart field `avatar`, images only (jpeg/png/gif/webp, ≤ `UPLOAD_MAX_FILE_SIZE`). Returns `{ message, user }`; the updated profile is seeded into the shared `['me']` query and then refetched.
- `DELETE /user/delete-avatar` — body `{ avatar: "<path>" }` (exact path from `avatars`).

## Notes
- `avatars` are server-relative paths that already include the `uploads/` mount (`uploads/avatars/…`) → resolve via `absoluteUploadUrl()`, which strips that segment before joining `uploadsBaseUrl` (never `/uploads/uploads/...`).
- Never set `Content-Type` on the avatar FormData request: React Native writes `multipart/form-data; boundary=…` itself; a manual header drops the boundary and the backend answers `400 Multipart: Boundary not found`.
- The local picker URI is only used for the upload; the profile always displays the path the backend stored.
- `isOnline`/`lastSeen` are broken server-side; do not build presence UI on them.
