import { Socket } from 'socket.io';
import { JwtPayload } from './jwt-payload.type';
import { ChatId } from './brands.type';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';

export interface SocketAuth extends Socket {
    data: {
        user: JwtPayload;
        chatId?: ChatId;
        /** Cached at joinChat so typing events never hit the DB for these. */
        chatType?: TypeChatEnum;
        userName?: string;
        /** Per-socket 1s `typing:start` throttle (one active chat per socket). */
        typingAt?: number;
        typingChatId?: ChatId;
    };
}
