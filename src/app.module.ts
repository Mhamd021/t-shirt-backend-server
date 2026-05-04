import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { DesignModule } from './design/design.module';
import { UploadModule } from './upload/upload.module';
import { OrderModule } from './order/order.module';
import { MailModule } from './mail/mail.module';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
     PrismaModule, AuthModule, UsersModule, DesignModule, UploadModule, OrderModule, MailModule, AdminModule,AiModule ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
