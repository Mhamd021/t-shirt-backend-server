import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAIProvider } from './providers/openai.provider';

@Module({
  controllers: [AiController],
  providers: [AiService, OllamaProvider, OpenAIProvider],
})
export class AiModule {}