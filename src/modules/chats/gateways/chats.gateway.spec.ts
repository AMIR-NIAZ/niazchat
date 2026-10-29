import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chats.gateway';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from '../services/chat.service';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';
import { ChatMember } from '../entities/chat_members.entity';

describe('ChatGateway', () => {
    let gateway: ChatGateway;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChatGateway,
                { provide: ChatService, useValue: {} },
                { provide: JwtAppService, useValue: {} },
                { provide: getRepositoryToken(ChatMember), useValue: {} },
            ],
        }).compile();

        gateway = module.get<ChatGateway>(ChatGateway);
    });

    it('should be defined', () => {
        expect(gateway).toBeDefined();
    });
});
