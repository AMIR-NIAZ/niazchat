import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForwardMessagesDto } from './forwardMessages.dto';

async function errors(overrides: Record<string, unknown>) {
    const dto = plainToInstance(ForwardMessagesDto, {
        fromChatId: 1,
        messageIds: [1],
        toChatIds: [2],
        requestId: 'req_12345',
        ...overrides,
    });
    return validate(dto);
}

describe('ForwardMessagesDto', () => {
    it('accepts the documented shape', async () => {
        expect(await errors({})).toHaveLength(0);
    });

    it('rejects empty, duplicate and >20 message ids', async () => {
        expect(await errors({ messageIds: [] })).not.toHaveLength(0);
        expect(await errors({ messageIds: [1, 1] })).not.toHaveLength(0);
        expect(
            await errors({
                messageIds: Array.from({ length: 21 }, (_, i) => i + 1),
            }),
        ).not.toHaveLength(0);
    });

    it('rejects empty, duplicate, >5 and non-positive targets', async () => {
        expect(await errors({ toChatIds: [] })).not.toHaveLength(0);
        expect(await errors({ toChatIds: [2, 2] })).not.toHaveLength(0);
        expect(
            await errors({ toChatIds: [1, 2, 3, 4, 5, 6] }),
        ).not.toHaveLength(0);
        expect(await errors({ toChatIds: [-1] })).not.toHaveLength(0);
    });

    it('rejects malformed ids and requestIds', async () => {
        expect(await errors({ messageIds: [0] })).not.toHaveLength(0);
        expect(await errors({ messageIds: ['1'] })).not.toHaveLength(0);
        expect(await errors({ toChatIds: [1.5] })).not.toHaveLength(0);
        expect(await errors({ fromChatId: 1.5 })).not.toHaveLength(0);
        expect(await errors({ requestId: 'short' })).not.toHaveLength(0);
        expect(
            await errors({ requestId: 'bad id with spaces' }),
        ).not.toHaveLength(0);
        expect(await errors({ requestId: 'a'.repeat(65) })).not.toHaveLength(0);
    });
});
