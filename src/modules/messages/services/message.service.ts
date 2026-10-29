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
import { WsException } from '@nestjs/websockets';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { TypeMessage } from '../entities/typeMessage.entity';
import fs from 'fs';
import { ChatId, MessageId, UserId } from 'src/common/types/brands.type';
import { ContentResolverService } from './content-resolver.service';
import { toUserResponse } from 'src/modules/auth/utils/user-response.util';

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
        @InjectRepository(TypeMessage)
        private readonly typeMessageRepository: Repository<TypeMessage>,
        private readonly contentResolver: ContentResolverService,
    ) {}

    async create(user: JwtPayload, dto: CreateMessageDto): Promise<Message> {
        const { chatId, reply, userId, type } = dto;

        const content = await this.contentResolver.resolve(dto.content, type);

        if (chatId) {
            return this.sendChat(chatId, user, reply, content, type);
        }

        if (userId) {
            return this.sendPv(userId, user, reply, content, type);
        }

        throw new BadRequestException();
    }

    private async sendChat(
        chatId: ChatId,
        user: JwtPayload,
        reply: MessageId | undefined,
        content: string,
        type: TypeMessageEnum,
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

        const typeData = await this.typeMessageRepository.findOneOrFail({
            where: { name: type },
        });

        const newMessage = await this.messageRepository.save({
            content,
            sender: { id: user.sub },
            chat: { id: chatId },
            replyTo: { id: reply },
            type: { id: typeData.id },
        });

        newMessage.sender = await this.loadSender(user.sub);
        return newMessage;
    }

    private async sendPv(
        userId: UserId,
        user: JwtPayload,
        reply: MessageId | undefined,
        content: string,
        type: TypeMessageEnum,
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

        let finalChatId: ChatId;
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

        const typeData = await this.typeMessageRepository.findOneOrFail({
            where: { name: type },
        });

        const newMessage = await this.messageRepository.save({
            content,
            sender: { id: user.sub },
            chat: { id: finalChatId },
            replyTo: { id: reply },
            type: { id: typeData.id },
        });

        newMessage.sender = await this.loadSender(user.sub);
        return newMessage;
    }

    async edit(dto: EditMessageDto, user: JwtPayload) {
        const { messageId, newContent, chatId } = dto;

        const message = await this.messageRepository.findOne({
            where: {
                id: messageId,
                chat: { id: chatId },
                sender: { id: user.sub },
                isDeleted: false,
            },
            relations: { type: true, sender: { profile: true } },
        });
        if (!message) throw new WsException('message not found');

        if (message.type.name !== TypeMessageEnum.TEXT) {
            throw new WsException('only text messages can be edited');
        }

        message.content = newContent;
        message.isEdited = true;

        return this.serializeSender(await this.messageRepository.save(message));
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
        if (!message) throw new WsException('message not found');

        await this.messageRepository.update(messageId, { isDeleted: true });
    }

    async getAllByChats(chatId: ChatId) {
        const messages = await this.messageRepository.find({
            where: {
                chat: { id: chatId },
                isDeleted: false,
            },
            relations: { sender: { profile: true } },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
                content: true,
                isEdited: true,
                isDeleted: true,
                sender: {
                    id: true,
                    phone: true,
                    isOnline: true,
                    lastSeen: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    profile: {
                        id: true,
                        name: true,
                        username: true,
                        biografy: true,
                        avatars: true,
                    },
                },
            },
            order: { id: 'DESC' },
            take: 50,
        });

        return messages.map((message) => this.serializeSender(message));
    }

    private serializeSender(message: Message): Message {
        if (message.sender) {
            message.sender = toUserResponse(message.sender) as unknown as User;
        }
        return message;
    }

    private async loadSender(userId: UserId): Promise<User> {
        const sender = await this.userRepository.findOne({
            where: { id: userId },
            relations: { profile: true },
            select: {
                id: true,
                phone: true,
                isOnline: true,
                lastSeen: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                profile: {
                    id: true,
                    name: true,
                    username: true,
                    biografy: true,
                    avatars: true,
                },
            },
        });

        if (!sender) throw new NotFoundException('sender not found');

        return toUserResponse(sender) as unknown as User;
    }
}
