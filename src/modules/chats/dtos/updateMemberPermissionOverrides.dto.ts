import { IsIn, IsOptional } from 'class-validator';
import {
    MEMBER_PERMISSION_OVERRIDE_STATES,
    type MemberPermissionOverrideState,
} from '../utils/member-permissions.util';

/**
 * Partial tri-state patch for ONE member. Every key accepts
 * `inherit | allow | deny`; unknown keys are rejected by the global
 * `forbidNonWhitelisted` validation pipe and re-validated in the service.
 */
export class UpdateMemberPermissionOverridesDto {
    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    send_messages?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    send_media?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    send_files?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    send_voice?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    send_links?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    add_members?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    invite_via_link?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    pin_messages?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    edit_own_messages?: MemberPermissionOverrideState;

    @IsOptional()
    @IsIn(MEMBER_PERMISSION_OVERRIDE_STATES)
    delete_own_messages?: MemberPermissionOverrideState;
}
