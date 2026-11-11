import { UserId } from './brands.type';

export interface JwtPayload {
    sub: UserId;
    role: string;
    /** Standard JWT expiry (seconds); set by the signer, absent on forged input. */
    exp?: number;
}
