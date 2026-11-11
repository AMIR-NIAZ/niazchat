import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { openJoinLink, openMessageLink } from './open-invite-link';

jest.mock('expo-router', () => ({
    router: { push: jest.fn() },
}));

jest.mock('expo-linking', () => ({
    openURL: jest.fn(async () => true),
}));

const CODE = 'kQ3v8m2Xy7pLr4Tz1aBcDe';
const INVITE_URL = `niazchat://join/${CODE}`;

describe('openJoinLink', () => {
    let now = 1_000_000;

    beforeEach(() => {
        jest.clearAllMocks();
        now += 10_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('navigates to the join screen with the extracted code', () => {
        expect(openJoinLink(INVITE_URL)).toBe(true);
        expect(router.push).toHaveBeenCalledWith({
            pathname: '/join/[code]',
            params: { code: CODE },
        });
        expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('extracts the code from Expo Go and https links too', () => {
        expect(
            openJoinLink(`exp://192.168.1.2:8081/--/join/${CODE}`),
        ).toBe(true);
        now += 10_000;
        expect(openJoinLink(`https://x.test/join/${CODE}`)).toBe(true);
        expect(router.push).toHaveBeenNthCalledWith(1, {
            pathname: '/join/[code]',
            params: { code: CODE },
        });
        expect(router.push).toHaveBeenNthCalledWith(2, {
            pathname: '/join/[code]',
            params: { code: CODE },
        });
    });

    it('routes a double tap only once', () => {
        expect(openJoinLink(INVITE_URL)).toBe(true);
        expect(openJoinLink(INVITE_URL)).toBe(true);
        expect(router.push).toHaveBeenCalledTimes(1);
    });

    it('refuses URLs that do not carry a valid invitation', () => {
        expect(openJoinLink('https://x.test/')).toBe(false);
        expect(openJoinLink(`https://x.test/join/${CODE.slice(0, 21)}`)).toBe(
            false,
        );
        expect(router.push).not.toHaveBeenCalled();
    });
});

describe('openMessageLink', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sends an invitation link to the join flow, not the browser', () => {
        openMessageLink(INVITE_URL);
        expect(router.push).toHaveBeenCalledWith({
            pathname: '/join/[code]',
            params: { code: CODE },
        });
        expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('opens any other absolute URL outside the app', () => {
        openMessageLink('https://example.com/invite/abc123');
        expect(router.push).not.toHaveBeenCalled();
        expect(Linking.openURL).toHaveBeenCalledWith(
            'https://example.com/invite/abc123',
        );
    });
});
