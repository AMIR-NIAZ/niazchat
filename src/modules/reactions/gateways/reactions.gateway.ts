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
import { chatRoom } from 'src/common/utils/roomCreator.utils';

@WebSocketGateway()
@UseGuards(wsPayload, wsIsBanMember, wsIsMemberChat)
export class ReactionsGateway {
    @WebSocketServer()
    private server: Server;

    constructor(private readonly reactionsService: ReactionsService) {}

    @SubscribeMessage('addReaction')
    async addReaction(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ReactionDto,
    ) {
        const reaction = await this.reactionsService.reaction(dto, client.data.user);

        this.server.to(chatRoom(dto.chatId)).emit('reaction:added', reaction);
    }

    @SubscribeMessage('removeReaction')
    async removeReaction(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ReactionDto,
    ) {
        const removed = await this.reactionsService.unReaction(dto, client.data.user);

        this.server.to(chatRoom(dto.chatId)).emit('reaction:removed', removed);
    }
}
