import { SetMetadata } from '@nestjs/common';

export const ROLE_KEY = 'roles';

export const Role = (data: string[]) => SetMetadata(ROLE_KEY, data);
