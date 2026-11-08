import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    Injectable,
} from '@nestjs/common';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { UserService } from '../services/user.service';
import { MAX_USER_AVATARS } from '../utils/avatar.util';

/**
 * Rejects an upload BEFORE multer stores it when the caller already has the
 * maximum number of avatars. The service re-checks the limit inside the same
 * transaction as the array write, so concurrent uploads cannot slip past this
 * early guard.
 */
@Injectable()
export class AvatarLimitGuard implements CanActivate {
    constructor(private readonly userService: UserService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<RequestAuth>();
        const count = await this.userService.countAvatars(request.user.sub);
        if (count >= MAX_USER_AVATARS) {
            throw new BadRequestException(
                `You can have at most ${MAX_USER_AVATARS} profile photos. Delete one before uploading a new photo.`,
            );
        }
        return true;
    }
}
