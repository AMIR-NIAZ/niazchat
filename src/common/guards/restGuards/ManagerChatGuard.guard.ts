import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ManagerChatGuard implements CanActivate {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Http = context.switchToHttp();
        const request = Http.getRequest<RequestAuth>();
        const userPayloade = request.user;

        const chatId: number = +request.params.chatId;
        const memberId: number = +request.params.memberId;
        let member: ChatMember | null;

        if (chatId) {
            member = await this.memberRepository.findOne({
                where: {
                    user: { id: userPayloade.sub },
                    chat: { id: chatId },
                },
            });
            if (!member) throw new ForbiddenException();
        } else if (memberId) {
            member = await this.memberRepository.findOne({
                where: {
                    id: memberId,
                },
            });
            if (!member) throw new ForbiddenException();
        } else {
            throw new BadRequestException('chat id not valid');
        }

        const manageRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.MANAGER },
        });
        if (!manageRole) throw new NotFoundException('manage role not found');

        if (member.role.id === manageRole.id) return true;

        throw new ForbiddenException();
    }
}
