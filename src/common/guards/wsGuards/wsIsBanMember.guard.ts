import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatMember } from '../../../modules/chats/entities/chat_members.entity';
import { Repository } from 'typeorm';
import { RoleChatEnum } from '../../enums/roleChat.enum';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { WsException } from '@nestjs/websockets';
import { ChatId } from 'src/common/types/brands.type';
import WebSocketData from 'src/common/types/websocket.type';

@Injectable()
export class wsIsBanMember implements CanActivate {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Ws = context.switchToWs();
        const client = Ws.getClient<SocketAuth>();
        const data: WebSocketData = Ws.getData();
        const userPayload = client.data.user;

        const chatId = (data.chatId ? data.chatId : data.dto.chatId) as ChatId;
        if (!chatId) throw new WsException('chat id not valid');

        const IsBan = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: userPayload.sub },
            },
        });
        if (!IsBan) throw new WsException('member not found');

        const manageRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.BAN },
        });
        if (!manageRole) throw new WsException('manage role not found');

        if (IsBan.role.id === manageRole.id)
            throw new WsException('user cant access');

        return true;
    }
}
