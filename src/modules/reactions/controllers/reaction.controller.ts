import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
} from '@nestjs/common';
import { ReactionsService } from '../services/reactions.service';
import { CreateReactDto } from '../dto/create-react.dto';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { IsPublic } from 'src/common/decorators/public.decorator';

@Controller('react')
export class ReactionController {
    constructor(private readonly reactionService: ReactionsService) {}

    @Post('/')
    @IsPublic()
    async create(@Body() dto: CreateReactDto) {
        return await this.reactionService.create(dto);
    }

    @Put(':reactId')
    @Role([RoleEnum.ADMIN])
    async update(
        @Body() dto: CreateReactDto,
        @Param('reactId') reactId: number,
    ) {
        return await this.reactionService.update(dto, reactId);
    }

    @Delete(':reactId')
    @Role([RoleEnum.ADMIN])
    async delete(@Param('reactId') reactId: number) {
        return await this.reactionService.remove(reactId);
    }

    @Get()
    @Role([RoleEnum.ALL])
    async getAll() {
        return await this.reactionService.findAll();
    }
}
