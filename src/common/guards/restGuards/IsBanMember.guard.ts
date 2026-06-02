import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatMember } from '../../../modules/chats/entities/chat_members.entity';
import { Repository } from 'typeorm';
import { RequestAuth } from '../../types/RequestAuth.type';
import { RoleChatEnum } from '../../enums/roleChat.enum';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';

@Injectable()
export class IsBanMember implements CanActivate {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Http = context.switchToHttp();
        const request = Http.getRequest<RequestAuth>();
        const userPayload = request.user;

        const chatId: number = +request.params.chatId;
        if (!chatId) throw new BadRequestException('chat id not valid');

        const IsBan = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: userPayload.sub },
            },
        });
        if (!IsBan) throw new NotFoundException('member not found');

        const manageRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.BAN },
        });
        if (!manageRole) throw new NotFoundException('manage role not found');

        if (IsBan.role.id === manageRole.id)
            throw new ForbiddenException('user cant access');

        return true;
    }
}
