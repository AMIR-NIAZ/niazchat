import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * `POST /contacts`. Exactly one of `userId` / `username` / `phone` is required;
 * the rule is enforced in the service so every combination answers a 400 with
 * a single clear message.
 */
export class CreateContactDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    userId?: number;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    username?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    phone?: string;

    /** Custom name for this person, e.g. "Maryam (work)". */
    @IsOptional()
    @IsString()
    @MaxLength(60)
    alias?: string;
}

/** `PATCH /contacts/:id`. `null` clears the custom name. */
export class UpdateContactDto {
    @IsOptional()
    @IsString()
    @MaxLength(60)
    alias?: string | null;
}
