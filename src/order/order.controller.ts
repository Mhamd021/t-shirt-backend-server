import {
  Controller, Get, Post, Patch,
  Body, Param, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ShirtSize, OrderStatus } from '@prisma/client';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderController {
  constructor(private orderService: OrderService) {}

  // Customer ينشئ طلب
  @Post()
  @Roles('CUSTOMER',
'ADMIN'

  )
  create(
    @CurrentUser() user: any,
    @Body() body: {
      designId: number;
      size: ShirtSize;
      address: {
        street: string;
        city: string;
        country: string;
        zip: string;
      };
      notes?: string;
    },
  ) {
    return this.orderService.create(user.id, body);
  }

  // Customer يرى طلباته
  @Get('my')
  @Roles('CUSTOMER')
  findMyOrders(@CurrentUser() user: any) {
    return this.orderService.findMyOrders(user.id);
  }

  @Get(':id')
  @Roles('CUSTOMER')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.orderService.findOne(id, user.id);
  }

  @Get()
  @Roles('PRINTER', 'ADMIN')
  findAll() {
    return this.orderService.findAllOrders();
  }

  @Patch(':id/status')
  @Roles('PRINTER', 'ADMIN')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: OrderStatus,
  ) {
    return this.orderService.updateStatus(id, status);
  }
}