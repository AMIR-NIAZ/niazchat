import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from 'src/common/types/jwt-payload.type';

@Injectable()
export class JwtAppService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) {}

    async generateToken(payload: JwtPayload) {
        const accessToken: string = await this.generateAccessToken(payload);
        const refreshToken: string = await this.generateRefreshToken(payload);

        return {
            accessToken,
            refreshToken,
        };
    }

    async verifyAccessToken(token: string) {
        try {
            const payload: JwtPayload = await this.jwtService.verifyAsync(
                token,
                {
                    secret: this.configService.get<string>(
                        'ACCESS_TOKEN_SECRET',
                    ),
                    ignoreExpiration: false,
                },
            );

            return payload;
        } catch (error) {
            throw new UnauthorizedException(error);
        }
    }

    async verfiyRefreshToken(token: string) {
        try {
            const payload: JwtPayload = await this.jwtService.verifyAsync(
                token,
                {
                    secret: this.configService.get<string>(
                        'REFRESH_TOKEN_SECRET',
                    ),
                    ignoreExpiration: false,
                },
            );

            return payload;
        } catch (error) {
            throw new UnauthorizedException(error);
        }
    }

    async generateAccessToken(payload: JwtPayload): Promise<string> {
        return await this.jwtService.signAsync(payload, {
            secret: this.configService.get<string>('ACCESS_TOKEN_SECRET'),
            expiresIn: '1h',
        });
    }

    async generateRefreshToken(payload: JwtPayload): Promise<string> {
        return await this.jwtService.signAsync(payload, {
            secret: this.configService.get<string>('REFRESH_TOKEN_SECRET'),
            expiresIn: '30d',
        });
    }
}
