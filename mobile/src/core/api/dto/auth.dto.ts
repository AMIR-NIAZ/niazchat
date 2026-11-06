/**
 * Auth request/response DTOs (docs/mobile-api/authentication.md).
 */

/** `POST /auth/send-otp` — Iranian phone format only (`@IsPhoneNumber('IR')`). */
export interface SendOtpPayloadDto {
  phone: string;
}

/** `POST /auth/verify-otp`. */
export interface VerifyOtpPayloadDto {
  phone: string;
  code: string;
}

/** `POST /auth/verify-otp` success body `{ message, data }`. */
export interface AuthTokensDto {
  accessToken: string;
  /** 30 days; refresh does NOT rotate it. */
  refreshToken: string;
}

/** `POST /auth/refresh-token` success body. Note: the request must use the raw `token` header. */
export interface RefreshTokenResponseDto {
  accessToken: string;
}

/** `PUT /user/updateme` — all three fields are required by backend validation (`forbidNonWhitelisted`). */
export interface UpdateProfilePayloadDto {
  /** Max 20 chars. */
  name: string;
  /** 5–32 chars, `/^[a-zA-Z][a-zA-Z0-9_]*[a-zA-Z0-9]$/`. */
  username: string;
  /** Max 100 chars. */
  biografy: string;
}

/** `DELETE /user/delete-avatar` — exact path string from `avatars`. */
export interface DeleteAvatarPayloadDto {
  avatar: string;
}
