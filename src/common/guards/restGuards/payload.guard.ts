import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';

@Injectable()
export class PayloadGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly jwtService: JwtAppService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const publicMethod: boolean = this.reflector.get(
            PUBLIC_KEY,
            context.getHandler(),
        );
        const Http = context.switchToHttp();
        const request = Http.getRequest<Request>();

        let token: string = '';
        if (!publicMethod) {
            token = this.getToken(request);
        }

        try {
            const payload = await this.jwtService.verifyAccessToken(token);
            request['user'] = payload;
        } catch (error) {
            if (publicMethod) return true;
            throw new UnauthorizedException(`token not valid ${error}`);
        }

        return true;
    }

    private getToken(request: Request) {
        const authHeader: string | null = request.headers['authorization'];

        if (
            typeof authHeader !== 'string' ||
            !authHeader.startsWith('Bearer ')
        ) {
            throw new UnauthorizedException('token not valid');
        }
        const token = authHeader.split(' ')[1];

        return token;
    }
}
