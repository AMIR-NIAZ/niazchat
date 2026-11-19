import { IsBoolean, IsOptional } from 'class-validator';

/**
 * PATCH body for `PATCH /chats/:chatId/member-permissions`.
 *
 * Every field is optional (partial update) but must be a boolean when present.
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, so ANY key that
 * is not one of the ten contract permissions is rejected with 400 before the
 * service is reached. The service re-validates shape so direct callers and
 * tests get the same guarantees.
 */
export class UpdateGroupMemberPermissionsDto {
    // ── Messaging ──────────────────────────────────────────────────────────
    @IsOptional()
    @IsBoolean()
    send_messages?: boolean;

    @IsOptional()
    @IsBoolean()
    send_media?: boolean;

    @IsOptional()
    @IsBoolean()
    send_files?: boolean;

    @IsOptional()
    @IsBoolean()
    send_voice?: boolean;

    @IsOptional()
    @IsBoolean()
    send_links?: boolean;

    // ── Group participation ────────────────────────────────────────────────
    @IsOptional()
    @IsBoolean()
    add_members?: boolean;

    @IsOptional()
    @IsBoolean()
    invite_via_link?: boolean;

    // ── Message management ─────────────────────────────────────────────────
    @IsOptional()
    @IsBoolean()
    pin_messages?: boolean;

    @IsOptional()
    @IsBoolean()
    edit_own_messages?: boolean;

    @IsOptional()
    @IsBoolean()
    delete_own_messages?: boolean;
}
