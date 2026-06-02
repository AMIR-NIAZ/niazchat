import {
    WebSocketGateway,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    WebSocketServer,
} from '@nestjs/websockets';
import { ReactionsService } from '../services/reactions.service';
import { UseGuards } from '@nestjs/common';
import { Server } from 'socket.io';
import { ReactionDto } from '../dto/reaction.dto';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { wsIsBanMember } from 'src/common/guards/wsGuards/wsIsBanMember.guard';

@WebSocketGateway()
@UseGuards(wsPayload, wsIsMemberChat, wsIsBanMember)
export class ReactionsGateway {
    @WebSocketServer()
    server: Server;
    constructor(private readonly reactionsService: ReactionsService) {}

    @SubscribeMessage('Reaction')
    async create(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ReactionDto,
    ) {
        const userAction = await this.reactionsService.reaction(
            dto,
            client.data.user,
        );

        this.server
            .to(`chat:${dto.chatId}`)
            .emit('reaction', { react: userAction });
    }

    @SubscribeMessage('noReaction')
    async remove(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ReactionDto,
    ) {
        const reactDeleted = await this.reactionsService.unReaction(
            dto,
            client.data.user,
        );

        this.server.to(`chat:${dto.chatId}`).emit('reaction', reactDeleted);
    }
}
