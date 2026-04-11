import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
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

@WebSocketGateway()
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
    async getMessages(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: number,
    ) {
        const messages = await this.messageService.getAllByChats(
            client.data.user,
            chatId,
        );

        client.emit('getMessages', messages);
    }
}
