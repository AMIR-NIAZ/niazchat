import { Request } from 'express';
import { JwtPayload } from './jwt-payload.type';

export interface RequestAuth extends Request {
    user: JwtPayload;
}
