import {
    Body,
    Controller,
    Get,
    Headers,
    Param,
    Post,
    Put,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { IsPublic } from 'src/common/decorators/public.decorator';
import { PhoneDto } from '../dtos/phone.dto';
import { VerifyDto } from '../dtos/verify.dto';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { IsBanPhone } from 'src/common/guards/restGuards/IsBanPhone.guard';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('send-otp')
    @UseGuards(IsBanPhone)
    @IsPublic()
    async sendOtp(@Body() dto: PhoneDto) {
        return await this.authService.register(dto);
    }

    @Post('verify-otp')
    @IsPublic()
    async verifyOtp(@Body() dto: VerifyDto) {
        return await this.authService.verifyUserByOtp(dto);
    }

    @Post('refresh-token')
    @IsPublic()
    async refreshToken(@Headers('token') token: string) {
        return await this.authService.refreshToken(token);
    }

    @Get('getme')
    @Role([RoleEnum.ALL])
    async getMe(@Req() req: RequestAuth) {
        return await this.authService.getme(req.user);
    }

    @Put('ban/:id')
    @Role([RoleEnum.ADMIN])
    async banUser(@Param('id') id: number) {
        await this.authService.banUser(id);
    }
}
