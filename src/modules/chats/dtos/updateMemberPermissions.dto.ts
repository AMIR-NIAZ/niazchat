import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/**
 * Body of `PUT /chats/:chatId/members/:memberId/permissions` (and the promote
 * route's optional initial permission set).
 *
 * Only the SHAPE is validated here: an array of strings. The service validates
 * the names against the contract (`GroupPermission` + `all`), rejects unknown
 * keys with 400 and removes duplicates. An empty array removes every grant.
 */
export class UpdateMemberPermissionsDto {
    @IsArray()
    @ArrayMaxSize(64)
    @IsString({ each: true })
    permissions: string[];
}
