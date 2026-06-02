import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { createChatDto } from '../dtos/createChat.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Chat } from '../entities/chat.entity';
import { Not, Repository } from 'typeorm';
import { ChatMember } from '../entities/chat_members.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatSeen } from '../entities/chats_seen.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import { WsException } from '@nestjs/websockets';
import * as fs from 'fs';
import { RoleChat } from '../entities/role_chat.entity';
import { PermissionChat } from '../entities/permission_chat.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';

@Injectable()
export class ChatService {
    constructor(
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(ChatSeen)
        private readonly seenRepository: Repository<ChatSeen>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
        @InjectRepository(PermissionChat)
        private readonly permissionChatRepository: Repository<PermissionChat>,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
    ) {}

    async createGroup(dto: createChatDto, user: JwtPayload) {
        const { title, members } = dto;
        const uniqueMembers = [...new Set(members)].filter(
            (id) => id != user.sub,
        );

        const chat = await this.chatRepository.save({
            title,
            type: TypeChatEnum.GRUPE,
        });

        const userRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.USER },
        });

        const adminRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.ADMIN },
        });

        if (!userRole || !adminRole) {
            throw new NotFoundException('role not found');
        }

        const allMembers = [
            {
                chat: { id: chat.id },
                user: { id: user.sub },
                role: { id: adminRole.id },
            },
            ...uniqueMembers.map((u) => ({
                chat: { id: chat.id },
                user: { id: u },
                role: { id: userRole.id },
            })),
        ];

        await this.memberRepository.insert(allMembers);
        return { message: 'group created successfully' };
    }

    async addMemberByPhone(chatId: number, userPhone: string) {
        const userRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.USER },
        });
        if (!userRole) throw new NotFoundException('role not found');

        await this.memberRepository.save({
            chat: { id: chatId },
            user: { phone: userPhone },
            role: { id: userRole?.id },
        });

        return { message: 'user added succeccfull' };
    }

    async getUserChats(user: JwtPayload): Promise<Chat[]> {
        const chats = await this.memberRepository
            .createQueryBuilder('member')
            .leftJoinAndSelect('member.chat', 'chat')
            .where('member.user.id = :userId', { userId: user.sub })
            .andWhere('chat.isBan = :isban', { isban: false })
            .orderBy('chat.updatedAt', 'DESC')
            .getMany()
            .then((memberships) => memberships.map((m) => m.chat));

        return chats;
    }

    async getInfoChat(id: number) {
        return await this.chatRepository.findOne({ where: { id } });
    }

    async uploadAvatar(avatar: string, chatId: number) {
        const chat = await this.chatRepository.findOne({
            where: {
                type: Not(TypeChatEnum.PRIVATE),
                id: chatId,
            },
        });
        if (!chat) throw new NotFoundException();

        chat.avatars = [...chat.avatars, avatar];
        await this.chatRepository.save(chat);

        return { message: 'avatar updated successfully' };
    }

    async deleteAvatar(chatId: number, avatarPath: string) {
        const chat = await this.chatRepository.findOne({
            where: {
                type: Not(TypeChatEnum.PRIVATE),
                id: chatId,
            },
        });
        if (!chat) throw new NotFoundException();

        if (!chat.avatars.includes(avatarPath)) throw new NotFoundException();

        chat.avatars = chat.avatars.filter((avatar) => avatar !== avatarPath);
        await this.chatRepository.save(chat);
        if (fs.existsSync(avatarPath)) {
            await fs.promises.unlink(avatarPath);
        }

        return { message: 'avatar updated successfully' };
    }

    async seening(chatId: number, user: JwtPayload) {
        const lastMessage = await this.messageRepository.findOne({
            where: {
                chat: { id: chatId },
            },
            order: { id: 'DESC' },
        });
        if (!lastMessage)
            throw new WsException('this chat not found last message');

        let read = await this.seenRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: user.sub },
            },
        });

        if (read) {
            read.message = lastMessage;
        } else {
            read = this.seenRepository.create({
                user: { id: user.sub },
                chat: { id: chatId },
                message: { id: lastMessage.id },
            });
        }
        await this.seenRepository.save(read);

        return lastMessage.id;
    }

    async banMember(id: number) {
        const member = await this.memberRepository.findOne({
            where: {
                id,
            },
        });
        if (!member) throw new NotFoundException();

        const manageRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.MANAGER },
        });
        if (!manageRole) throw new NotFoundException('manage role not found');
        if (member.id === manageRole.id)
            throw new BadRequestException('manager chat cant ban');

        const banRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.BAN },
        });
        if (!banRole) throw new NotFoundException('ban role not found');

        member.role = banRole;
        await this.memberRepository.save(member);

        return { message: 'user baned successfully' };
    }

    async onBanMember(id: number) {
        const member = await this.memberRepository.findOne({
            where: {
                id,
            },
        });
        if (!member) throw new NotFoundException();

        const userRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.USER },
        });
        if (!userRole) throw new NotFoundException('ban role not found');

        member.role = userRole;
        await this.memberRepository.save(member);

        return { message: 'user on baned successfully' };
    }

    async getAllBanUser(chatId: number) {
        const chat = await this.chatRepository.findOne({
            where: {
                id: chatId,
                type: Not(TypeChatEnum.PRIVATE),
            },
        });
        if (!chat) throw new NotFoundException('chat not found');

        const roleBanChat = await this.roleChatRepository.findOne({
            where: {
                name: RoleChatEnum.BAN,
            },
        });
        if (!roleBanChat) throw new NotFoundException('ban role Not found');

        const banUsers = await this.memberRepository.find({
            where: {
                chat: { id: chatId },
                role: { id: roleBanChat.id },
            },
            relations: ['user'],
            order: { updatedAt: 'DESC' },
        });

        return { data: banUsers };
    }

    async getAllUser(chatId: number) {
        const chat = await this.chatRepository.findOne({
            where: {
                id: chatId,
                isBan: false,
                type: Not(TypeChatEnum.PRIVATE),
            },
        });
        if (!chat) throw new NotFoundException('chat not found');

        const roleBanChat = await this.roleChatRepository.findOne({
            where: {
                name: RoleChatEnum.BAN,
            },
        });

        const Users = await this.memberRepository.find({
            where: {
                chat: { id: chatId },
                role: Not({ id: roleBanChat?.id }),
            },
            relations: ['user'],
            order: { updatedAt: 'DESC' },
        });

        return { data: Users };
    }

    async banChat(id: number) {
        const chat = await this.chatRepository.findOne({
            where: {
                id,
                isBan: false,
                type: Not(TypeChatEnum.PRIVATE),
            },
        });
        if (!chat) throw new NotFoundException('chat not found');

        await this.chatRepository.update(chat.id, {
            isBan: true,
            avatars: [],
        });

        await this.deleteAllAvatar(chat.avatars);

        return { message: 'chat is ban successfully' };
    }

    private async deleteAllAvatar(avatars: string[]): Promise<void> {
        try {
            for (const img of avatars) {
                const fileExists = await fs.promises
                    .stat(img)
                    .then(() => true)
                    .catch(() => false);
                if (fileExists) {
                    await fs.promises.unlink(img);
                }
            }
        } catch (err) {
            throw new InternalServerErrorException(err);
        }
    }
}
