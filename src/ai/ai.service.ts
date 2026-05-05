import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { AIProvider } from './providers/ai-provider.interface';

@Injectable()
export class AiService {
  private provider: AIProvider;

  constructor(
    private config: ConfigService,
    private ollamaProvider: OllamaProvider,
    private openaiProvider: OpenAIProvider,
  ) {
    const isDev = config.get('NODE_ENV') !== 'production';
    this.provider = isDev ? ollamaProvider : openaiProvider;
  }

  generateDesignSuggestions(prompt: string) {
    return this.provider.generateDesignSuggestions(prompt);
  }

  generateColorPalette(theme: string) {
    return this.provider.generateColorPalette(theme);
  }

  generateDecalText(context: string) {
    return this.provider.generateDecalText(context);
  }
}