import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadController } from './upload.controller';
import { CloudinaryService } from './cloudinary.service';
import { RemoveBgService } from './removebg.service';

@Module({
  imports: [
    MulterModule.register({ storage: memoryStorage() }),
  ],
  providers: [CloudinaryService,RemoveBgService],
  controllers: [UploadController]
})
export class UploadModule {}
