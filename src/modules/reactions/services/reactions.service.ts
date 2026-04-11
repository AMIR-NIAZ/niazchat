import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateReactDto } from '../dto/create-react.dto';
import { Repository } from 'typeorm';
import { React } from '../entities/react.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateReactDto } from '../dto/update-react.dto';
import { MessageReact } from '../entities/message_react.entity';
import { ReactionDto } from '../dto/reaction.dto';
import { Message } from 'src/modules/messages/entities/message.entity';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class ReactionsService {
    constructor(
        @InjectRepository(React)
        private readonly reactRepository: Repository<React>,
        @InjectRepository(MessageReact)
        private readonly messageReactRepository: Repository<MessageReact>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
    ) {}

    async create(dto: CreateReactDto) {
        const { name, emoji } = dto;
        await this.reactRepository.save({ name, emoji });

        return { message: 'react creacted successfully' };
    }

    async findAll() {
        return await this.reactRepository.find({});
    }

    async update(dto: UpdateReactDto, id: number) {
        const react = await this.reactRepository.findOne({ where: { id } });
        if (!react) throw new NotFoundException('react not found');

        const statusUpdate = await this.reactRepository.update(id, dto);
        return { message: `react updated is ${statusUpdate.affected}` };
    }

    async remove(id: number) {
        const react = await this.reactRepository.findOne({ where: { id } });
        if (!react) throw new NotFoundException('react not found');

        await this.reactRepository.delete(id);
        return { message: `This action removes a #${id} react` };
    }

    async reaction(dto: ReactionDto, user: JwtPayload) {
        const { messageId, reactId } = dto;

        const hasMessage = await this.messageRepository.exists({
            where: { id: messageId },
        });
        const hasReact = await this.reactRepository.exists({
            where: { id: reactId },
        });
        const hasUserReacted = await this.messageReactRepository.findOne({
            where: {
                message: { id: messageId },
                user: { id: user.sub },
            },
        });
        if (!hasMessage) throw new WsException('message not found');
        if (!hasReact) throw new WsException('react not found');
        if (!hasUserReacted) throw new WsException('user already reacted');

        const react = await this.messageReactRepository.save({
            message: { id: messageId },
            react: { id: reactId },
            user: { id: user.sub },
        });
        return react;
    }

    async unReaction(dto: ReactionDto, user: JwtPayload) {
        const { messageId, reactId } = dto;

        const hasMessage = await this.messageRepository.exists({
            where: { id: messageId },
        });
        const hasReact = await this.reactRepository.exists({
            where: { id: reactId },
        });
        const UserReacted = await this.messageReactRepository.findOne({
            where: {
                message: { id: messageId },
                react: { id: reactId },
                user: { id: user.sub },
            },
        });
        if (!hasMessage) throw new WsException('message not found');
        if (!(hasReact && UserReacted))
            throw new WsException('react not found');

        await this.messageReactRepository.delete(UserReacted);

        return UserReacted;
    }
}
