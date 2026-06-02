import { SetMetadata } from '@nestjs/common';
import { PermissionChatEnum } from '../enums/permissionChat.enum';

export const PERMISSION_CHAT_KEY = 'permission-chat';

export const PermissionAdminChat = (per: PermissionChatEnum[]) =>
    SetMetadata(PERMISSION_CHAT_KEY, per);
