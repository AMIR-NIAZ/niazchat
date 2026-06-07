import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WsException } from '@nestjs/websockets'; // ✅ تغییر: استفاده از WsException
import { ChatId } from 'src/common/types/brands.type';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import WebSocketData from 'src/common/types/websocket.type';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { Repository } from 'typeorm';

@Injectable()
export class wsIsMemberChat implements CanActivate {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Ws = context.switchToWs();
        const client = Ws.getClient<SocketAuth>();
        const data: WebSocketData = Ws.getData();
        const user = client.data.user;

        const chatId = (data.chatId ? data.chatId : data.dto.chatId) as ChatId;

        if (!chatId || isNaN(chatId)) throw new WsException('Invalid chat ID');

        const member = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: user.sub },
            },
        });

        if (!member) {
            throw new WsException('You are not a member of this chat');
        }

        return true;
    }
}
