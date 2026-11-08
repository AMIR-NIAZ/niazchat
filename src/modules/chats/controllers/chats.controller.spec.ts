import { Test, TestingModule } from '@nestjs/testing';
import { ChatsController } from './chats.controller';
import { ChatService } from '../services/chat.service';
import { InviteLinkService } from '../services/inviteLink.service';
import { GroupRealtimeService } from '../services/group-realtime.service';

describe('ChatsController', () => {
    let controller: ChatsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ChatsController],
            providers: [
                { provide: ChatService, useValue: {} },
                { provide: InviteLinkService, useValue: {} },
                { provide: GroupRealtimeService, useValue: {} },
            ],
        }).compile();

        controller = module.get<ChatsController>(ChatsController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
