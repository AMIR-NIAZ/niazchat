import { UserId } from './brands.type';

export interface JwtPayload {
    sub: UserId;
    role: string;
}
