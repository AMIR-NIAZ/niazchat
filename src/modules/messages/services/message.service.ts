import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Message } from '../entities/message.entity';
import { Repository } from 'typeorm';
import { CreateMessageDto } from '../dtos/createMessage.dto';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { EditMessageDto } from '../dtos/EditMessage.dto';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { deleteMessageDto } from '../dtos/deleteMessage.dto';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { User } from 'src/modules/auth/entities/user.entity';

@Injectable()
export class MessageService {
    constructor(
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    async create(user: JwtPayload, dto: CreateMessageDto) {
        const { chatId, content, reply, userId } = dto;
        if (chatId) {
            return this.sendGap(chatId, user, reply, content);
        } else if (userId) {
            return this.sendPv(userId, user, reply, content);
        }
    }

    private async sendGap(
        chatId: number,
        user: JwtPayload,
        reply: number | undefined,
        content: string,
    ) {
        const isMember = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: user.sub },
            },
        });
        if (!isMember) throw new BadRequestException('user not exit in chat');

        if (reply) {
            const exists = await this.messageRepository.exists({
                where: { id: reply },
            });
            if (!exists) throw new NotFoundException('reply message not found');
        }

        const newMessage = await this.messageRepository.save({
            content,
            sender: { id: user.sub },
            chat: { id: chatId },
            replyTo: { id: reply },
        });

        return newMessage;
    }

    private async sendPv(
        userId: number,
        user: JwtPayload,
        reply: number | undefined,
        content: string,
    ) {
        const hasUserReceiver = await this.userRepository.findOne({
            where: { id: userId },
        });

        if (!hasUserReceiver) throw new NotFoundException('receiver not Found');

        const chats = await this.chatRepository.find({
            where: {
                type: TypeChatEnum.PRIVATE,
                members: {
                    user: { id: user.sub },
                },
            },
            relations: ['members', 'members.user'],
        });
        const existingChat = chats.find((chat) =>
            chat.members.some((m) => m.user.id === userId),
        );

        let finalChatId: number;
        if (existingChat) {
            finalChatId = existingChat.id;
        } else {
            const newPrivateChat = await this.chatRepository.save({
                type: TypeChatEnum.PRIVATE,
            });
            await this.memberRepository.save([
                {
                    chat: { id: newPrivateChat.id },
                    user: { id: user.sub },
                },
                {
                    chat: { id: newPrivateChat.id },
                    user: { id: userId },
                },
            ]);

            finalChatId = newPrivateChat.id;
        }

        const newMessage = await this.messageRepository.save({
            content,
            sender: { id: user.sub },
            chat: { id: finalChatId },
            replyTo: { id: reply },
        });

        return newMessage;
    }

    async edit(dto: EditMessageDto, user: JwtPayload) {
        const { messageId, newContent, chatId } = dto;

        const message = await this.messageRepository.findOne({
            where: {
                id: messageId,
                chat: { id: chatId },
                sender: { id: user.sub },
            },
        });
        if (!message) throw new NotFoundException('message not found');

        await this.messageRepository.update(messageId, {
            content: newContent,
            isEdited: true,
        });

        const newMessage = await this.messageRepository.findOne({
            where: { id: messageId },
        });
        return newMessage;
    }

    async delete(dto: deleteMessageDto, user: JwtPayload) {
        const { chatId, messageId } = dto;

        const message = await this.messageRepository.findOne({
            where: {
                id: messageId,
                chat: { id: chatId },
                sender: { id: user.sub },
                isDeleted: false,
            },
        });
        if (!message) throw new NotFoundException('message not found');

        await this.messageRepository.update(messageId, { isDeleted: true });
    }

    async getAllByChats(user: JwtPayload, chatId: number) {
        const member = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: user.sub },
            },
        });

        if (!member) throw new BadRequestException();

        return await this.messageRepository.find({
            where: {
                chat: { id: chatId },
                isDeleted: false,
            },
            order: { id: 'DESC' },
            take: 50,
        });
    }
}
