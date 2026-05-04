import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { DesignService } from './design.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('designs')
@UseGuards(JwtAuthGuard)
export class DesignController {
  constructor(private designService: DesignService) {}

  @Post()
  create(
    @CurrentUser() user: any,
    @Body() body: { name?: string; shirtColor?: string; decals?: any[] },
  ) {
    return this.designService.create(user.id, body);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.designService.findAllByUser(user.id);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.designService.findOne(id, user.id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Body() body: { name?: string; shirtColor?: string; decals?: any[] },
  ) {
    return this.designService.update(id, user.id, body);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.designService.remove(id, user.id);
  }
}