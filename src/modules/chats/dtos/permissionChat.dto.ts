import { IsEnum } from 'class-validator';
import { PermissionChatEnum } from '../../../common/enums/permissionChat.enum';

export class PermissionChatDto {
    @IsEnum(PermissionChatEnum, { each: true })
    permissions: PermissionChatEnum[];
}
