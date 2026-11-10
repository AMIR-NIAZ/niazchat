import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Hash } from 'src/common/utils/hash.utils';

/**
 * `POST /auth/refresh-token` must answer 401 (never 403/500) for every kind of
 * invalid refresh token, and only 200 for a JWT that still matches the hash
 * stored on the user row.
 */
describe('AuthService.refreshToken', () => {
    const jwtService = {
        verfiyRefreshToken: jest.fn(),
        generateAccessToken: jest.fn(),
    };
    const userRepository = { findOne: jest.fn() };

    const service = new AuthService(
        userRepository as never,
        {} as never,
        {} as never,
        {} as never,
        jwtService as never,
        {} as never,
        {} as never,
        {} as never,
    );

    beforeEach(() => {
        jest.clearAllMocks();
        jwtService.generateAccessToken.mockResolvedValue('new-access-token');
    });

    it('rejects a missing/blank token with 401', async () => {
        await expect(service.refreshToken('')).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        await expect(
            service.refreshToken(undefined as unknown as string),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(jwtService.verfiyRefreshToken).not.toHaveBeenCalled();
    });

    it('normalizes an invalid/expired JWT to 401', async () => {
        jwtService.verfiyRefreshToken.mockRejectedValue(
            new UnauthorizedException('jwt expired'),
        );
        await expect(
            service.refreshToken('bad.jwt.value'),
        ).rejects.toMatchObject({
            status: 401,
            message: 'invalid refresh token',
        });
    });

    it('normalizes a hash mismatch to 401 instead of 403', async () => {
        jwtService.verfiyRefreshToken.mockResolvedValue({
            sub: 5,
            role: 'user',
        });
        userRepository.findOne.mockResolvedValue({
            id: 5,
            refreshToken: await Hash('the-other-device-token'),
        });

        await expect(service.refreshToken('stale-token')).rejects.toMatchObject(
            { status: 401, message: 'invalid refresh token' },
        );
    });

    it('returns a new access token for the matching stored refresh token', async () => {
        const stored = await Hash('my-refresh-token');
        jwtService.verfiyRefreshToken.mockResolvedValue({
            sub: 5,
            role: 'user',
        });
        userRepository.findOne.mockResolvedValue({
            id: 5,
            refreshToken: stored,
        });

        await expect(service.refreshToken('my-refresh-token')).resolves.toEqual(
            {
                accessToken: 'new-access-token',
            },
        );
        expect(jwtService.generateAccessToken).toHaveBeenCalledWith({
            sub: 5,
            role: 'user',
        });
    });
});
