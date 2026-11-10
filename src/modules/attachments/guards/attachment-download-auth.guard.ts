import {
    CanActivate,
    ExecutionContext,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { AttachmentService } from '../services/attachment.service';

/**
 * Authorizes `GET /attachments/:id/download`, which is the one route reachable
 * with a short-lived signed URL (video players do not always forward bearer
 * headers). Accepts either:
 *  - a normal `Authorization: Bearer <access token>`, or
 *  - `exp` + `sig` query params bound to THIS attachment id and user id.
 *
 * A signature grants only this GET. Membership/ban/deleted checks still run in
 * the service, so a valid signature for a stale attachment still 404s.
 */
@Injectable()
export class AttachmentDownloadAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtAppService,
        private readonly attachments: AttachmentService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<Request & Partial<RequestAuth>>();
        const id = Number(request.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw new NotFoundException('attachment not found');
        }

        const { uid, exp, sig } = request.query;
        if (
            typeof uid === 'string' &&
            typeof exp === 'string' &&
            typeof sig === 'string'
        ) {
            const userId = this.attachments.resolveStreamSignature(
                id,
                uid,
                exp,
                sig,
            );
            if (userId === null) {
                throw new NotFoundException('attachment not found');
            }
            request.user = { sub: userId as never, role: 'user' };
            return true;
        }

        const header = request.headers.authorization;
        if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
            throw new UnauthorizedException('token not valid');
        }
        try {
            request.user = await this.jwtService.verifyAccessToken(
                header.slice('Bearer '.length),
            );
        } catch {
            throw new UnauthorizedException('token not valid');
        }
        return true;
    }
}
