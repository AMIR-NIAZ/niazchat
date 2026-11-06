import { z } from 'zod';

/**
 * Auth form validation (UI schema layer).
 *
 * Backend constraint (docs/mobile-api/authentication.md):
 * `phone` must satisfy `@IsPhoneNumber('IR')` — Iranian mobile numbers.
 * We model the canonical E.164 Iranian mobile format; the server may accept
 * variants (e.g. landlines) but the messaging UX is phone-number based.
 * `code`: the backend only applies `@IsString()` (no length constraint), so the
 * schema enforces no minimum content — exactly matching the server contract.
 */

export const phoneSchema = z
  .string()
  .min(1, 'Phone number is required.')
  .regex(/^\+989\d{9}$/, 'Enter an Iranian mobile number, e.g. +989123456789');

export const verifyCodeSchema = z
  .string()
  .min(1, 'Code is required.');

export const sendOtpSchema = z.object({ phone: phoneSchema });
export const verifyOtpSchema = z.object({ phone: phoneSchema, code: verifyCodeSchema });

export type SendOtpFormValues = z.infer<typeof sendOtpSchema>;
export type VerifyOtpFormValues = z.infer<typeof verifyOtpSchema>;
