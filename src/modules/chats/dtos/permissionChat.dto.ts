import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * Legacy permission body (`/chats/manage/admin/*`). Accepts the contract keys,
 * legacy aliases and `all`; the service normalizes/pre-validates them.
 */
export class PermissionChatDto {
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    permissions?: string[];
}
