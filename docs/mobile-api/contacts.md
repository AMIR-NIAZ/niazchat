# Contacts

Sources: `src/modules/auth/controllers/contacts.controller.ts`,
`src/modules/auth/services/contacts.service.ts`,
`src/modules/auth/services/user.service.ts#matchContacts`,
`src/modules/auth/utils/contacts-match.util.ts`,
`src/modules/auth/dtos/contact.dto.ts`,
`src/modules/auth/dtos/contacts-match.dto.ts`.

The Contacts tab has two sources, shown together in one alphabetical list:

1. **My contacts** — people the user saved inside the app (`/contacts` CRUD).
2. **From your phone** — device address-book entries that match a registered
   account (`POST /contacts/match`).

A person present in both appears once; the saved contact wins and keeps its
custom name.

---

## Saved contacts

All routes require an access token (`401` otherwise) and are scoped to the
caller: another user's contact id answers `404`, never `403`.

### `GET /contacts`

Bare object (no `data` wrapper), non-paginated (the app caps a few thousand),
sorted by alias/name with `Intl.Collator('fa')`.

```json
{
  "items": [
    {
      "id": 12,
      "userId": 7,
      "alias": "Maryam (work)",
      "name": "Maryam",
      "username": "maryam_1990",
      "avatars": ["http://host:3000/uploads/avatars/current.png"],
      "phone": "+989121234567"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Saved-contact id (used by `PATCH` / `DELETE`). |
| `userId` | Registered account this contact points to. |
| `alias` | Custom name the owner gave; `null` when unset. |
| `name` | The account's display name (`'بدون نام'` fallback). |
| `username` | `null` when the account has no username. |
| `avatars` | At most the current photo, **absolute** URL built from the request origin. |
| `phone` | **Only present** when the contact was saved by phone; it is the exact E.164 number the owner supplied. Saving by id/username never discloses a phone. |

### `POST /contacts`

Body — exactly **one** of `userId`, `username`, `phone` (a `400` otherwise),
plus optional `alias` (≤ 60 chars, trimmed; empty = no alias).

```json
{ "phone": "09121234567", "alias": "Maryam (work)" }
```

- `phone` is normalized with `libphonenumber-js` using the default region `IR`
  and stored/compared as E.164. The user profile has no country field today, so
  `IR` is the documented fallback.
- `username` is case-insensitive and accepts a leading `@`.
- Only `active` users resolve.
- Returns the created item (same shape as a list item).

| Status | When | Message |
| --- | --- | --- |
| `400` | Not exactly one selector / invalid phone / self | `Provide exactly one of userId, username or phone` / `phone must be a valid number` / `You cannot add yourself` |
| `404` | No active account matches | `This person isn't on the app yet` |
| `409` | Already in the caller's contacts | `Already in your contacts`, plus `item` with the existing contact |
| `429` | More than 30 creates per minute per caller | `Too many contact changes, try again later` |

```json
{
  "success": false,
  "statusCode": 409,
  "message": "Already in your contacts",
  "item": { "id": 12, "userId": 7, "alias": null, "...": "..." }
}
```

### `PATCH /contacts/:id`

Body `{ "alias": "New name" }` or `{ "alias": null }` to clear it. Owner only;
`404` for someone else's id.

### `DELETE /contacts/:id`

Owner only; `404` for someone else's id. Returns `{ "message": "Contact removed" }`.

---

## `POST /contacts/match`

The app reads the address book on the device, normalizes every number to E.164
(`libphonenumber-js`) and uploads **only numbers** — never names, emails or
labels. The server answers with the accounts among those numbers.

- Auth: authenticated users only (global guard → `401` without a token).
- Body:

```json
{ "phones": ["+989121234567", "+14155550123"] }
```

| Rule | Behavior |
| --- | --- |
| Array | required (`400 phones must be an array of E.164 strings`) |
| Max size | 500 entries per request (`400 phones must contain at most 500 numbers`) |
| Entries | strings; values that do not parse as E.164 are dropped, not echoed |
| Duplicates | removed before the query |
| Rate limit | 10 requests per minute per caller (`429 Too many contact matches, try again later`) |

The uploaded list is **never stored or logged**.

### Response

Bare object (no `data` wrapper), only users whose `users.phone` is in the
uploaded set and whose `status` is `active`. The caller is excluded.

```json
{
  "items": [
    {
      "userId": 7,
      "name": "Sara",
      "username": "sara_1990",
      "avatars": ["uploads/avatars/current.png"],
      "phone": "+989121234567"
    }
  ]
}
```

- `userId` is numeric (bigint cast), `username` is `null` when unset.
- `name` falls back to `'بدون نام'`.
- `avatars` holds at most the **current** photo (server-relative path, same as
  `GET /user/search`; the app resolves it with `absoluteUploadUrl()`).
- `phone` is repeated exactly because the caller uploaded that number. It is
  the canonical E.164 form, so the app can map the hit back to its local
  contact name.
- `deleted` and `baned` accounts are never returned.
- One indexed query: `WHERE "phone" IN (...)`. Order is by phone; the app
  re-sorts by contact name.

### Errors

| Status | When |
| --- | --- |
| `400` | `phones` missing / not an array / not strings / more than 500 |
| `401` | Missing or expired access token |
| `429` | More than 10 requests in the current minute |

## Caveat: phone numbers are not verified

`users.phone` is only "proof of possession" at registration (OTP). A number
can be entered/claimed by whoever controls that phone at signup time, and
there is no re-verification afterwards. Matching is therefore **best effort**:
a hit means "this app account was created with this number", not "this person
is in your address book". A phone is only ever disclosed to a caller who
already uploaded that number, so the endpoint cannot be used to enumerate
accounts or harvest phone numbers.

Device contacts are matched on request: the app keeps the address-book index
in memory only, never persists raw contacts, and clears it on logout.

## Checking it

`scripts/contacts-match.js` covers the match endpoint.
`scripts/contacts.js` covers the saved-contact CRUD, duplicates, self/unknown
handling, access control and `401`.
