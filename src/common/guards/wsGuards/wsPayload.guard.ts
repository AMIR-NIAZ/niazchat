import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';
import { WsException } from '@nestjs/websockets';
import { SocketAuth } from '../../types/SocketAuth.type';
import { JwtPayload } from '../../types/jwt-payload.type';

@Injectable()
export class wsPayload implements CanActivate {
    constructor(private readonly jwtService: JwtAppService) {}
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Ws = context.switchToWs();
        const client: SocketAuth = Ws.getClient();
        const token: string = this.getToken(client);

        try {
            const payload: JwtPayload =
                await this.jwtService.verifyAccessToken(token);
            client.data.user = payload;
        } catch (error) {
            throw new WsException(`token in valid, ${error}`);
        }

        return true;
    }

    private getToken(client: Socket): string {
        const authHeader = client.handshake.headers?.authorization;
        if (
            typeof authHeader !== 'string' ||
            !authHeader.startsWith('Bearer ')
        ) {
            throw new WsException('token in valid');
        }
        const token = authHeader.split(' ')[1];

        return token;
    }
}
