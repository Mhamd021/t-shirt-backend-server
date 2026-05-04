export interface DesignSuggestion {
  shirtColor: string;
  suggestions: {
    type: 'TEXT' | 'IMAGE';
    text?: string;
    font?: string;
    fontSize?: number;
    textColor?: string;
    side: 'front' | 'back';
  }[];
  reasoning: string;
}

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  mood: string;
}

export interface AIProvider {
  generateDesignSuggestions(prompt: string): Promise<DesignSuggestion>;
  generateColorPalette(theme: string): Promise<ColorPalette>;
  generateDecalText(context: string): Promise<string[]>;
}