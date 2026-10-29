import { Test, TestingModule } from '@nestjs/testing';
import { MessageGateway } from './message.gateway';
import { MessageService } from '../services/message.service';
import { ChatService } from 'src/modules/chats/services/chat.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';

describe('MessageGateway', () => {
    let gateway: MessageGateway;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MessageGateway,
                { provide: MessageService, useValue: {} },
                { provide: ChatService, useValue: {} },
                { provide: JwtAppService, useValue: {} },
                { provide: getRepositoryToken(ChatMember), useValue: {} },
                { provide: getRepositoryToken(RoleChat), useValue: {} },
            ],
        }).compile();

        gateway = module.get<MessageGateway>(MessageGateway);
    });

    it('should be defined', () => {
        expect(gateway).toBeDefined();
    });
});
