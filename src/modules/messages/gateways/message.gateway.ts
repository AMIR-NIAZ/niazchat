import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { MessageService } from '../services/message.service';
import { CreateMessageDto } from '../dtos/createMessage.dto';
import { EditMessageDto } from '../dtos/EditMessage.dto';
import { deleteMessageDto } from '../dtos/deleteMessage.dto';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { ParseIntPipe, UseGuards } from '@nestjs/common';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { wsIsBanMember } from 'src/common/guards/wsGuards/wsIsBanMember.guard';

@WebSocketGateway({ maxHttpBufferSize: 1e8 })
@UseGuards(wsPayload, wsIsBanMember)
export class MessageGateway {
    constructor(private readonly messageService: MessageService) {}

    @WebSocketServer()
    server: Server;

    @SubscribeMessage('sendMessage')
    async sendMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: CreateMessageDto,
    ) {
        const messages = await this.messageService.create(
            client.data.user,
            dto,
        );

        this.server.to(`chat:${dto.chatId}`).emit('sendMessage:list', messages);
    }

    @SubscribeMessage('editMessage')
    @UseGuards(wsIsMemberChat)
    async editMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: EditMessageDto,
    ) {
        const newMessage = await this.messageService.edit(
            dto,
            client.data.user,
        );

        this.server
            .to(`chat:${dto.chatId}`)
            .emit('editMessage:list', newMessage);
    }

    @SubscribeMessage('deleteMessage')
    @UseGuards(wsIsMemberChat)
    async deleteMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: deleteMessageDto,
    ) {
        await this.messageService.delete(dto, client.data.user);

        this.server
            .to(`chat:${dto.chatId}`)
            .emit('deleteMessage:list', dto.messageId);
    }

    @SubscribeMessage('getMessages')
    @UseGuards(wsIsMemberChat)
    async getMessages(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody('chatId', new ParseIntPipe()) chatId: number,
    ) {
        const messages = await this.messageService.getAllByChats(chatId);

        client.emit('getMessages', messages);
    }
}
