import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'public';

export const IsPublic = () => SetMetadata(PUBLIC_KEY, true);
