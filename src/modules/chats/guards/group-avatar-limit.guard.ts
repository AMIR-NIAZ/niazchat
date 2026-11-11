import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GroupInfoService } from '../services/group-info.service';

/**
 * Rejects a group photo upload BEFORE multer stores the file when the group
 * already holds `MAX_GROUP_AVATARS` photos. Guards run before interceptors, so
 * the 11th file never reaches the disk; the service re-checks the limit inside
 * the locked transaction, so concurrent uploads cannot slip past this guard.
 */
@Injectable()
export class GroupAvatarLimitGuard implements CanActivate {
    constructor(private readonly groupInfo: GroupInfoService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{
            params?: { chatId?: string };
        }>();
        const chatId = Number(request.params?.chatId);
        if (!Number.isInteger(chatId) || chatId <= 0) {
            // ParseIntPipe owns the parameter validation.
            return true;
        }
        await this.groupInfo.assertAvatarSlot(chatId);
        return true;
    }
}
