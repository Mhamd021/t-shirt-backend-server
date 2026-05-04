import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private aiService: AiService) {}

  @Post('design-suggestions')
  generateDesign(@Body('prompt') prompt: string) {
    return this.aiService.generateDesignSuggestions(prompt);
  }

  @Post('color-palette')
  generateColors(@Body('theme') theme: string) {
    return this.aiService.generateColorPalette(theme);
  }

  @Post('decal-text')
  generateText(@Body('context') context: string) {
    return this.aiService.generateDecalText(context);
  }
}