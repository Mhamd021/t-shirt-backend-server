import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import fetch from 'node-fetch';

@Injectable()
export class RemoveBgService {
  private readonly logger = new Logger(RemoveBgService.name);

  constructor(private config: ConfigService) {}

  async removeBackground(imageBuffer: Buffer): Promise<Buffer> {
    const formData = new FormData();
    formData.append('image_file', imageBuffer, {
      filename: 'image.png',
      contentType: 'image/png',
    });
    formData.append('size', 'auto');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': this.config.getOrThrow('REMOVEBG_API_KEY'),
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `remove.bg failed with status ${response.status}: ${errorBody}`,
      );
      throw new BadRequestException(
        `Background removal failed with status ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
