export interface ModelDetails {
  parent_model?: string;
  format?: string;
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
  context_length?: number;
  embedding_length?: number;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: ModelDetails;
  capabilities?: string[]; // e.g. ["completion", "tools", "thinking", "vision"]
}

export interface OllamaRunningModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  details?: ModelDetails;
  expires_at: string;
  size_vram: number;
  context_length?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  images?: string[];
}

export interface OllamaChatChunk {
  model: string;
  created_at: string;
  message?: {
    role: 'assistant';
    content: string;
    thinking?: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaShowResponse {
  license?: string;
  modelfile?: string;
  parameters?: string;
  template?: string;
  system?: string;
  details?: ModelDetails;
  model_info?: Record<string, any>;
  capabilities?: string[];
  modified_at?: string;
}

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface GenerationOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
  repeat_last_n?: number;
  presence_penalty?: number;
  seed?: number;
  num_predict?: number;
  num_ctx?: number;
  stop?: string[];
}

/**
 * Ollama `format` parameter: 'json' for free-form JSON mode, or a JSON Schema object
 * for grammar-constrained structured output (Ollama >= 0.5).
 */
export type OllamaFormat = 'json' | Record<string, any>;

/**
 * Ollama `think` parameter. Booleans toggle reasoning for thinking-capable models;
 * gpt-oss style models accept an effort level instead.
 */
export type OllamaThinkValue = boolean | 'low' | 'medium' | 'high';
