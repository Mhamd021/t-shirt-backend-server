import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { MailModule } from '../mail/mail.module';
import { OrderNotifierService } from './order-notifier-service';

@Module({
  imports: [MailModule],
  controllers: [OrderController],
  providers: [OrderService,OrderNotifierService],
})
export class OrderModule {}