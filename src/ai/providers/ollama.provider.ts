import { Injectable } from '@nestjs/common';
import { AIProvider, DesignSuggestion, ColorPalette } from './ai-provider.interface';
import { format } from 'path';

@Injectable()
export class OllamaProvider implements AIProvider {
  private baseUrl = 'http://localhost:11434';
  private model = 'tinyllama';  

  private async chat(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: "json"
      }),
    });

    const data = await response.json() as any;
    return data.response;
  }

  private extractJson(text: string): any {
    try {
    return JSON.parse(text);
  }catch{}
 const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON found in response');
    return JSON.parse(match[0]);
  
   
  }

 async generateDesignSuggestions(prompt: string): Promise<DesignSuggestion> {
  const result = await this.chat(`
    Return ONLY valid JSON. No explanations.
    Create a t-shirt design for: "${prompt}"
    {
      "shirtColor": "#CC0000",
      "suggestions": [
        {
          "type": "TEXT",
          "text": "CHAMPIONS",
          "font": "Impact",
          "fontSize": 28,
          "textColor": "#FFFFFF",
          "side": "front"
        }
      ],
      "reasoning": "Red represents energy and passion"
    }
  `);
  return this.extractJson(result);
}

  async generateColorPalette(theme: string): Promise<ColorPalette> {
    const result = await this.chat(`
      Return ONLY a JSON object:
      {
        "primary": "#hexcolor",
        "secondary": "#hexcolor", 
        "accent": "#hexcolor",
        "mood": "one sentence"
      }
      
      Theme: ${theme}
      Return ONLY JSON.
    `);

    return this.extractJson(result);
  }

  async generateDecalText(context: string): Promise<string[]> {
  const result = await this.chat(`
    Return ONLY valid JSON array of strings.
    Suggest 3 t-shirt texts for: "${context}"
    Example output: ["CHAMPIONS", "NEVER GIVE UP", "WIN IT ALL"]
    Return ONLY the JSON array, nothing else.
  `);

  const parsed = this.extractJson(result);

  if (Array.isArray(parsed)) return parsed;
  if (parsed.data) return parsed.data.flatMap((d: any) => d.text);
  return [];
}
}