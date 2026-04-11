import { Test, TestingModule } from '@nestjs/testing';
import { ReactionsGateway } from './reactions.gateway';
import { ReactionsService } from '../services/reactions.service';

describe('ReactionsGateway', () => {
    let gateway: ReactionsGateway;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ReactionsGateway, ReactionsService],
        }).compile();

        gateway = module.get<ReactionsGateway>(ReactionsGateway);
    });

    it('should be defined', () => {
        expect(gateway).toBeDefined();
    });
});
