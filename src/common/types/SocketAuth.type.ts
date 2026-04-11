import { Socket } from 'socket.io';
import { JwtPayload } from './jwt-payload.type';

export interface SocketAuth extends Socket {
    data: {
        user: JwtPayload;
    };
}
