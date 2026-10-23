import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { ParseIntPipe, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server } from 'socket.io';
import { MessageService } from '../services/message.service';
import { ChatService } from 'src/modules/chats/services/chat.service';
import { Message } from '../entities/message.entity';
import { CreateMessageDto } from '../dtos/createMessage.dto';
import { EditMessageDto } from '../dtos/EditMessage.dto';
import { deleteMessageDto } from '../dtos/deleteMessage.dto';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { wsIsBanMember } from 'src/common/guards/wsGuards/wsIsBanMember.guard';
import { ChatId, MessageId } from 'src/common/types/brands.type';
import { chatRoom, userRoom } from 'src/common/utils/roomCreator.utils';

@WebSocketGateway({ maxHttpBufferSize: 1e6 })
@UseGuards(wsPayload, wsIsBanMember)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class MessageGateway {
    @WebSocketServer()
    private server: Server;

    constructor(
        private readonly messageService: MessageService,
        private readonly chatService: ChatService,
    ) {}

    @SubscribeMessage('sendMessage')
    async sendMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: CreateMessageDto,
    ) {
        const message = await this.messageService.create(client.data.user, dto);
        const chatId = message.chat.id;

        this.server.to(chatRoom(chatId)).emit('sendMessage:list', message);
        await this.notifyChatList(chatId, message);
    }

    @SubscribeMessage('editMessage')
    @UseGuards(wsIsMemberChat)
    async editMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: EditMessageDto,
    ) {
        const message = await this.messageService.edit(dto, client.data.user);

        this.server.to(chatRoom(dto.chatId)).emit('editMessage:list', message);
        await this.notifyChatList(dto.chatId, message!);
    }

    @SubscribeMessage('deleteMessage')
    @UseGuards(wsIsMemberChat)
    async deleteMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: deleteMessageDto,
    ) {
        await this.messageService.delete(dto, client.data.user);

        this.server
            .to(chatRoom(dto.chatId))
            .emit('deleteMessage:list', dto.messageId);
    }

    @SubscribeMessage('getMessages')
    @UseGuards(wsIsMemberChat)
    async getMessages(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody('chatId', new ParseIntPipe()) chatId: ChatId,
    ) {
        const messages = await this.messageService.getAllByChats(chatId);
        client.emit('getMessages', messages);
    }

    private async notifyChatList(chatId: ChatId, message: Message) {
        const memberIds = await this.chatService.getMemberIds(chatId);
        const payload = {
            chatId,
            lastMessage: {
                id: message.id,
                content: message.content,
                senderId: message.sender?.id,
                createdAt: message.createdAt,
            },
        };

        for (const id of memberIds) {
            this.server.to(userRoom(id)).emit('chatlist:updated', payload);
        }
    }
}