import { Transform } from 'class-transformer';
import {
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';

/** Wire limits for group info (mirrored by the app). */
export const GROUP_TITLE_MAX_LENGTH = 64;
export const GROUP_DESCRIPTION_MAX_LENGTH = 255;

/** C0/C1 control characters (kept out of every stored string). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Single-line title: line breaks become spaces, control characters are
 * stripped and repeated whitespace is collapsed. Trimming happens last.
 */
export function sanitizeGroupTitle(raw: string): string {
    return raw
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(CONTROL_CHARACTERS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Multiline description: control characters except newline/tab are stripped
 * and the ends are trimmed. An empty result clears the description (null).
 */
export function sanitizeGroupDescription(raw: string | null): string | null {
    if (raw === null) return null;
    const cleaned = raw
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
        .trim();
    return cleaned === '' ? null : cleaned;
}

/**
 * `PATCH /chats/:chatId/group` body.
 *
 * At least one field must be present (checked in the service). Unknown fields
 * are rejected by the global `forbidNonWhitelisted` pipe. Values are
 * sanitized before validation, so the length limits apply to what is stored.
 */
export class UpdateGroupInfoDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }: { value: unknown }): unknown =>
        typeof value === 'string' ? sanitizeGroupTitle(value) : value,
    )
    @MinLength(1, { message: 'title must be between 1 and 64 characters' })
    @MaxLength(GROUP_TITLE_MAX_LENGTH, {
        message: 'title must be between 1 and 64 characters',
    })
    title?: string;

    @IsOptional()
    @ValidateIf((object: UpdateGroupInfoDto) => object.description !== null)
    @IsString()
    @Transform(({ value }: { value: unknown }): unknown =>
        typeof value === 'string' ? sanitizeGroupDescription(value) : value,
    )
    @MaxLength(GROUP_DESCRIPTION_MAX_LENGTH, {
        message: 'description must be at most 255 characters',
    })
    description?: string | null;
}
