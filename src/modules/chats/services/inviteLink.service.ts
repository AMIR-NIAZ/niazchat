// invite-link.service.ts
import {
    Injectable,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Link } from '../entities/link.entity';
import { randomBytes } from 'crypto';
import { Chat } from '../entities/chat.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { createLinkDto } from '../dtos/createLink.dto';

@Injectable()
export class InviteLinkService {
    constructor(
        @InjectRepository(Link)
        private LinkRepository: Repository<Link>,
        @InjectRepository(Chat)
        private chatRepository: Repository<Chat>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(ChatMember)
        private memberRepository: Repository<ChatMember>,
        @InjectRepository(RoleChat)
        private roleChatRepository: Repository<RoleChat>,
    ) {}

    async createInviteLink(dto: createLinkDto) {
        const { chatId, usageLimit, expiresAt } = dto;

        const chat = await this.chatRepository.findOneBy({ id: chatId });
        if (!chat) throw new NotFoundException('Chat not found');

        const code = this.generateUniqueCode();

        return await this.LinkRepository.save({
            code,
            chat: { id: chat.id },
            usageLimit: usageLimit || 0,
            expiresAt: expiresAt || null,
            isActive: true,
        });
    }

    private generateUniqueCode(): string {
        return randomBytes(16).toString('hex');
    }

    async notActiveInviteLink(linkId: number): Promise<void> {
        const inviteLink = await this.LinkRepository.findOne({
            where: { id: linkId },
            relations: ['chat'],
        });

        if (!inviteLink) throw new NotFoundException('Invite link not found');

        inviteLink.isActive = false;
        await this.LinkRepository.save(inviteLink);
    }

    async getChatInviteLinks(chatId: number): Promise<Link[]> {
        return await this.LinkRepository.find({
            where: {
                chat: { id: chatId },
            },
            order: { createdAt: 'DESC' },
        });
    }

    async joinByInviteCode(code: string, userId: number): Promise<Chat> {
        const inviteLink = await this.LinkRepository.findOne({
            where: {
                code,
                isActive: true,
            },
            relations: ['chat'],
        });

        if (!inviteLink)
            throw new BadRequestException('Invalid or expired invite link');

        if (inviteLink.expiresAt && inviteLink.expiresAt < new Date())
            throw new BadRequestException('Invite link has expired');

        if (
            inviteLink.usageLimit > 0 &&
            inviteLink.usageCount >= inviteLink.usageLimit
        )
            throw new BadRequestException('Invite link usage limit reached');

        const isAlreadyMember = await this.isChatMember(
            inviteLink.chat.id,
            userId,
        );
        if (isAlreadyMember)
            throw new BadRequestException(
                'You are already a member of this chat',
            );

        await this.addUserToChat(inviteLink.chat.id, userId);

        inviteLink.usageCount += 1;
        await this.LinkRepository.save(inviteLink);

        return inviteLink.chat;
    }

    private async isChatMember(
        chatId: number,
        userId: number,
    ): Promise<boolean> {
        const member = await this.chatRepository
            .createQueryBuilder('chat')
            .innerJoin('chat.members', 'user')
            .where('chat.id = :chatId', { chatId })
            .andWhere('user.id = :userId', { userId })
            .getOne();
        return !!member;
    }

    private async addUserToChat(chatId: number, userId: number): Promise<void> {
        const user = await this.userRepository.findOneBy({ id: userId });
        if (!user) throw new NotFoundException('user not found');

        const userRole = await this.roleChatRepository.findOneOrFail({
            where: {
                name: RoleChatEnum.USER,
            },
        });

        await this.memberRepository.save({
            chat: { id: chatId },
            user: { id: user.id },
            role: { name: userRole.name },
        });
    }
}
