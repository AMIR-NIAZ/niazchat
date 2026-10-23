import { Socket } from 'socket.io';
import { JwtPayload } from './jwt-payload.type';
import { ChatId } from './brands.type';

export interface SocketAuth extends Socket {
    data: {
        user: JwtPayload;
        chatId?: ChatId;
    };
}
