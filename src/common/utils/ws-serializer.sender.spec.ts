import { serializeMessage } from './ws-serializer.utils';
import type { Message } from 'src/modules/messages/entities/message.entity';

function messageWithSender(sender: unknown): Message {
    return {
        id: 7,
        content: 'hello',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        isEdited: false,
        isDeleted: false,
        chat: { id: 3 },
        sender,
        type: { id: 1, name: 'text' },
        attachments: [],
        replyTo: null,
        replyToId: null,
    } as unknown as Message;
}

const fullUser = {
    id: 11,
    phone: '09120000000',
    isOnline: true,
    lastSeen: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    profile: {
        id: 4,
        name: 'Ada',
        username: 'ada_dev',
        biografy: 'private notes',
        avatars: [
            'uploads/avatars/new.png',
            'uploads/avatars/old.png',
        ],
    },
};

describe('serializeMessage sender', () => {
    it('sends only id, name, username and the current avatar', () => {
        const wire = serializeMessage(messageWithSender(fullUser));
        const sender = wire.sender;
        expect(sender).not.toBeNull();

        expect(Object.keys(sender ?? {}).sort()).toEqual([
            'avatars',
            'id',
            'name',
            'username',
        ]);
        expect(wire.sender).toEqual({
            id: 11,
            name: 'Ada',
            username: 'ada_dev',
            avatars: ['uploads/avatars/new.png'],
        });

        const text = JSON.stringify(wire);
        for (const secret of [
            'phone',
            '09120000000',
            'lastSeen',
            'isOnline',
            'biografy',
            'status',
        ]) {
            expect(text).not.toContain(secret);
        }
    });

    it('keeps the array shape when the user has no photo', () => {
        const wire = serializeMessage(
            messageWithSender({
                ...fullUser,
                profile: { ...fullUser.profile, avatars: [] },
            }),
        );

        expect(wire.sender).toEqual({
            id: 11,
            name: 'Ada',
            username: 'ada_dev',
            avatars: [],
        });
    });

    it('serializes a null sender as null (deleted account)', () => {
        expect(serializeMessage(messageWithSender(null)).sender).toBeNull();
    });

    it('keeps the flat toUserResponse fallback working', () => {
        const wire = serializeMessage(
            messageWithSender({
                id: 12,
                name: 'Flattened',
                username: 'flat',
                avatars: ['uploads/avatars/only.png'],
            }),
        );

        expect(wire.sender).toEqual({
            id: 12,
            name: 'Flattened',
            username: 'flat',
            avatars: ['uploads/avatars/only.png'],
        });
    });
});
