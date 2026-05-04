import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AIProvider, DesignSuggestion, ColorPalette } from './ai-provider.interface';

@Injectable()
export class OpenAIProvider implements AIProvider {
  private openai: OpenAI;

  constructor(private config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: config.get('OPENAI_API_KEY'),
    });
  }

  private async chat(prompt: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    return response.choices[0].message.content ?? '{}';
  }

  async generateDesignSuggestions(prompt: string): Promise<DesignSuggestion> {
    const result = await this.chat(`
      You are a t-shirt design expert.
      Based on: "${prompt}"
      Return JSON: { shirtColor, suggestions[], reasoning }
    `);
    return JSON.parse(result);
  }

  async generateColorPalette(theme: string): Promise<ColorPalette> {
    const result = await this.chat(`
      Color palette for fashion theme: "${theme}"
      Return JSON: { primary, secondary, accent, mood }
    `);
    return JSON.parse(result);
  }

  async generateDecalText(context: string): Promise<string[]> {
    const result = await this.chat(`
      5 short t-shirt text options for: "${context}"
      Return JSON array of strings.
    `);
    return JSON.parse(result);
  }
}