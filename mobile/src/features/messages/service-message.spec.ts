import { serviceMessageText, toServiceMessage } from './service-message';
import type { ServiceMessageMetaDto } from '../../core/api/dto/message.dto';

function meta(
    overrides: Partial<ServiceMessageMetaDto> = {},
): ServiceMessageMetaDto {
    return {
        action: 'member_joined',
        actorId: 2,
        actorName: 'Ali',
        targetId: 2,
        targetName: 'Ali',
        ...overrides,
    };
}

describe('serviceMessageText', () => {
    it('renders every known action with the actor/target snapshots', () => {
        expect(serviceMessageText(toServiceMessage(meta(), ''), 1)).toBe(
            'Ali joined the group',
        );
        expect(
            serviceMessageText(
                toServiceMessage(
                    meta({ action: 'member_joined_via_link' }),
                    '',
                ),
                1,
            ),
        ).toBe('Ali joined via invite link');
        expect(
            serviceMessageText(
                toServiceMessage(
                    meta({
                        action: 'member_added',
                        actorId: 5,
                        actorName: 'Sara',
                        targetId: 2,
                        targetName: 'Ali',
                    }),
                    '',
                ),
                1,
            ),
        ).toBe('Sara added Ali');
        expect(
            serviceMessageText(
                toServiceMessage(meta({ action: 'member_left' }), ''),
                1,
            ),
        ).toBe('Ali left the group');
        expect(
            serviceMessageText(
                toServiceMessage(meta({ action: 'member_banned' }), ''),
                1,
            ),
        ).toBe('Ali was banned');
        expect(
            serviceMessageText(
                toServiceMessage(meta({ action: 'member_removed' }), ''),
                1,
            ),
        ).toBe('Ali was removed');
    });

    it('renders "You" when the viewer is the target', () => {
        expect(serviceMessageText(toServiceMessage(meta(), ''), 2)).toBe(
            'You joined the group',
        );
        expect(
            serviceMessageText(
                toServiceMessage(meta({ action: 'member_banned' }), ''),
                2,
            ),
        ).toBe('You were banned');
        expect(
            serviceMessageText(
                toServiceMessage(
                    meta({
                        action: 'member_added',
                        actorId: 5,
                        actorName: 'Sara',
                        targetId: 2,
                        targetName: 'Ali',
                    }),
                    '',
                ),
                2,
            ),
        ).toBe('Sara added You');
    });

    it('falls back to content for an unknown action', () => {
        const service = toServiceMessage(
            {
                ...meta(),
                action: 'member_promoted' as never,
            },
            'Ali was promoted',
        );
        expect(service?.action).toBe('unknown');
        expect(serviceMessageText(service, 1)).toBe('Ali was promoted');
    });

    it('returns the fallback content when meta is missing/malformed', () => {
        expect(toServiceMessage(null, 'Ali joined the group')).toBeNull();
        expect(toServiceMessage(undefined, '')).toBeNull();
        expect(serviceMessageText(null, 1)).toBe('');
    });
});
