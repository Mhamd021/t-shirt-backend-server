import {
  Controller, Post, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from './cloudinary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RemoveBgService } from './removebg.service';

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private cloudinaryService: CloudinaryService,private removeBgService: RemoveBgService,) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file:Express.Multer.File) {
    return this.cloudinaryService.uploadImage(file);
  }
  @Post('image/remove-bg')
  @UseInterceptors(FileInterceptor('file'))
  async uploadWithoutBg(@UploadedFile() file: Express.Multer.File) {
    
    const cleanedBuffer = await this.removeBgService.removeBackground(file.buffer);

    const cleanedFile: Express.Multer.File = {
      ...file,
      buffer: cleanedBuffer,
      mimetype: 'image/png',
      originalname: file.originalname.replace(/\.[^.]+$/, '.png'),
    };

    return this.cloudinaryService.uploadImage(cleanedFile);
  }
}