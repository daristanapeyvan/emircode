import { GenerationOptions } from '@/types/ollama';
import { GenerationPreset, DEFAULT_PRESETS } from '@/types/presets';

export class GenerationService {
  private presets: GenerationPreset[] = [...DEFAULT_PRESETS];

  setPresets(presets: GenerationPreset[]) {
    this.presets = presets;
  }

  getPresets(): GenerationPreset[] {
    return this.presets;
  }

  getPresetById(id: string): GenerationPreset | undefined {
    return this.presets.find((p) => p.id === id);
  }

  resolveOptions(presetId?: string, overrides?: GenerationOptions): GenerationOptions {
    const preset = this.getPresetById(presetId || 'balanced') || this.presets[0];
    return {
      ...preset.options,
      ...(overrides || {}),
    };
  }

  validateOptions(options: GenerationOptions): GenerationOptions {
    const clean: GenerationOptions = {};

    if (typeof options.temperature === 'number') {
      clean.temperature = Math.max(0, Math.min(2.0, options.temperature));
    }
    if (typeof options.top_p === 'number') {
      clean.top_p = Math.max(0.01, Math.min(1.0, options.top_p));
    }
    if (typeof options.top_k === 'number') {
      clean.top_k = Math.max(1, Math.min(200, Math.floor(options.top_k)));
    }
    if (typeof options.min_p === 'number') {
      clean.min_p = Math.max(0, Math.min(1.0, options.min_p));
    }
    if (typeof options.repeat_penalty === 'number') {
      clean.repeat_penalty = Math.max(0.5, Math.min(2.0, options.repeat_penalty));
    }
    if (typeof options.seed === 'number' && !isNaN(options.seed)) {
      clean.seed = options.seed;
    }
    if (typeof options.num_predict === 'number') {
      clean.num_predict = Math.max(1, options.num_predict);
    }
    if (typeof options.num_ctx === 'number') {
      clean.num_ctx = Math.max(512, options.num_ctx);
    }

    return clean;
  }
}

export const generationService = new GenerationService();
