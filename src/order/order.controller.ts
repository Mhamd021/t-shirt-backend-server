import {
  Controller, Get, Post, Patch,
  Body, Param, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {  OrderStatus,type User } from '@prisma/client';
import  {type CreateOrderDto, createOrderSchema, updateStatusSchema } from './order.schemas';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderController {
  constructor(private orderService: OrderService) { }

  @Post()
  @Roles('CUSTOMER',
    'ADMIN')
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderDto) {
    return this.orderService.create(user.id, body);
  }

  @Get('stuck')
  @Roles('ADMIN')
  findStuck() { return this.orderService.findStuck(); }

  @Post(':id/resend')
  @Roles('ADMIN')
  resend(@Param('id', ParseIntPipe) id: number) { return this.orderService.resendStuck(id); }

  @Get('my')
  @Roles('CUSTOMER')
  findMyOrders(@CurrentUser() user: User) {
    return this.orderService.findMyOrders(user.id);
  }

  @Get(':id')
  @Roles('CUSTOMER', 'PRINTER', 'ADMIN')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.orderService.findOne(id, { id: user.id, role: user.role });
  }

  @Get()
  @Roles('PRINTER', 'ADMIN')
  findAll(
    @CurrentUser() user: User,
  ) {
    return this.orderService.findAllOrders({ role: user.role });
  }

  @Patch(':id/status')
  @Roles('PRINTER', 'ADMIN')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateStatusSchema)) body: { status: OrderStatus }
  ) {
    return this.orderService.updateStatus(id, body.status, user.role);
  }
  @Post(':id/cancel')
  @Roles('CUSTOMER')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.orderService.cancel(id, user.id);
  }
}