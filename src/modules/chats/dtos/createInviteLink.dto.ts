import { IsIn, IsOptional } from 'class-validator';
import {
    INVITE_EXPIRY_OPTIONS,
    INVITE_MAX_USES_OPTIONS,
} from '../utils/invite-link.util';

/**
 * Strict allowlists (docs/mobile-api/groups.md). `null`/missing = never
 * expires and unlimited uses. Any other number is a 400 validation error.
 */
export class CreateInviteLinkDto {
    @IsOptional()
    @IsIn([...INVITE_EXPIRY_OPTIONS, null])
    expiresInSeconds?: number | null;

    @IsOptional()
    @IsIn([...INVITE_MAX_USES_OPTIONS, null])
    maxUses?: number | null;
}
