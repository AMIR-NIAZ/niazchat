import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WsException } from '@nestjs/websockets'; // ✅ تغییر: استفاده از WsException
import { ChatId } from 'src/common/types/brands.type';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import WebSocketData from 'src/common/types/websocket.type';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { Repository } from 'typeorm';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';

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

        const eventId = Ws.getPattern?.() ?? 'unknown event';
        const chatId =
            (data as { chatId?: unknown; fromChatId?: unknown } | null)
                ?.chatId ??
            (data as { fromChatId?: unknown } | null)?.fromChatId;
        const normalizedChatId =
            typeof chatId === 'number' ? (chatId as ChatId) : undefined;

        if (
            typeof normalizedChatId !== 'number' ||
            !Number.isFinite(normalizedChatId)
        ) {
            throw new WsException(
                `Invalid chat ID: "${eventId}" takes a payload object { chatId: number }`,
            );
        }

        const member = await this.memberRepository.findOne({
            where: {
                chat: { id: normalizedChatId },
                user: { id: user.sub },
            },
            relations: { role: true },
        });

        if (!member) {
            throw new WsException('You are not a member of this chat');
        }

        // A banned member (role marker) must not re-enter the room.
        if (member.role?.name === RoleChatEnum.BAN) {
            throw new WsException('You have been banned from this chat');
        }

        return true;
    }
}
