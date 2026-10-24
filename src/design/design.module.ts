import { Module } from '@nestjs/common';
import { DesignService } from './design.service';
import { DesignController } from './design.controller';
import { UploadModule } from '../upload/upload.module';

@Module({
  controllers: [DesignController],
  providers: [DesignService],
  imports: [UploadModule],
})
export class DesignModule {}