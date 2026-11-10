import {
    WebSocketGateway,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    WebSocketServer,
} from '@nestjs/websockets';
import {
    ReactionsService,
    reactionSnapshotForViewer,
} from '../services/reactions.service';
import {
    UseFilters,
    UseGuards,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { Server } from 'socket.io';
import {
    MessageReactionsQueryDto,
    ReactMessageDto,
} from '../dto/reaction.dto';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { wsIsBanMember } from 'src/common/guards/wsGuards/wsIsBanMember.guard';
import { WsExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { chatRoom } from 'src/common/utils/roomCreator.utils';

@WebSocketGateway()
@UseGuards(wsPayload, wsIsBanMember, wsIsMemberChat)
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseFilters(new WsExceptionFilter())
export class ReactionsGateway {
    @WebSocketServer()
    private server: Server;

    constructor(private readonly reactionsService: ReactionsService) {}

    /**
     * Toggle the caller's single reaction on a message. `emoji: null` clears
     * it. Every recipient receives the aggregated snapshot with their own
     * `myReaction`; reactor user ids are never broadcast.
     */
    @SubscribeMessage('reactMessage')
    async reactMessage(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: ReactMessageDto,
    ) {
        const state = await this.reactionsService.toggle(dto, client.data.user);
        if (state.changed) {
            const room = chatRoom(dto.chatId);
            const sockets = await this.server.in(room).fetchSockets();
            const delivered = new Set<string>();

            for (const socket of sockets) {
                const viewerId = (
                    socket.data as { user?: JwtPayload } | undefined
                )?.user?.sub;
                socket.emit(
                    'reaction:updated',
                    reactionSnapshotForViewer(state, viewerId),
                );
                delivered.add(socket.id);
            }

            if (!delivered.has(client.id)) {
                client.emit(
                    'reaction:updated',
                    reactionSnapshotForViewer(state, client.data.user.sub),
                );
            }
        }

        return {
            ok: true,
            data: reactionSnapshotForViewer(state, client.data.user.sub),
        };
    }

    /** Grouped reactor list for the message detail sheet (max 100 users). */
    @SubscribeMessage('getMessageReactions')
    async getMessageReactions(
        @MessageBody() dto: MessageReactionsQueryDto,
    ) {
        const reactions = await this.reactionsService.reactorsFor(
            Number(dto.chatId),
            Number(dto.messageId),
        );
        return { ok: true, data: { reactions } };
    }
}
