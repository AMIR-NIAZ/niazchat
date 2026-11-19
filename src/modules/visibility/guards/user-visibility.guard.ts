import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { VisibilityService } from '../visibility.service';

/**
 * Guards every endpoint whose `:userId` param addresses another user's profile
 * data. Unknown users and users who blocked the caller answer the SAME 404
 * (`This profile isn't available`), so the route cannot be used to probe.
 */
@Injectable()
export class UserVisibilityGuard implements CanActivate {
    constructor(private readonly visibility: VisibilityService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<RequestAuth>();
        const viewerId = request.user?.sub;
        const targetId = Number(request.params.userId);
        if (
            viewerId === undefined ||
            !Number.isInteger(targetId) ||
            targetId <= 0
        ) {
            // Malformed ids are answered by ParseIntPipe / the service.
            return true;
        }
        await this.visibility.assertCanViewUserProfile(
            Number(viewerId),
            targetId,
        );
        return true;
    }
}
