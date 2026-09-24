import { GenerationOptions } from './ollama';

export interface GenerationPreset {
  id: string;
  name: string;
  description: string;
  options: GenerationOptions;
  isBuiltIn?: boolean;
}

export interface SystemPromptPreset {
  id: string;
  name: string;
  content: string;
  isBuiltIn?: boolean;
}

export const DEFAULT_PRESETS: GenerationPreset[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good for general conversation, writing, and balanced answers.',
    options: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
    },
    isBuiltIn: true,
  },
  {
    id: 'precise',
    name: 'Precise',
    description: 'Focused, deterministic, ideal for factual queries and logic.',
    options: {
      temperature: 0.2,
      top_p: 0.8,
      top_k: 20,
      repeat_penalty: 1.15,
    },
    isBuiltIn: true,
  },
  {
    id: 'creative',
    name: 'Creative',
    description: 'High randomness, suitable for brainstorming and storytelling.',
    options: {
      temperature: 0.95,
      top_p: 0.95,
      top_k: 50,
      repeat_penalty: 1.05,
    },
    isBuiltIn: true,
  },
  {
    id: 'coding',
    name: 'Coding',
    description: 'Low temperature with focused sampling for precise syntax and algorithms.',
    options: {
      // Near-greedy sampling (0.1) makes local models loop on repeated lines; 0.3 stays precise.
      temperature: 0.3,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.05,
    },
    isBuiltIn: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'User-configured parameters.',
    options: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
    },
    isBuiltIn: true,
  },
];

export const DEFAULT_SYSTEM_PROMPTS: SystemPromptPreset[] = [
  {
    id: 'default',
    name: 'General Assistant',
    content: 'You are a helpful, clear, and concise AI assistant.',
    isBuiltIn: true,
  },
  {
    id: 'software-engineer',
    name: 'Senior Developer',
    content: 'You are an expert senior software engineer. Provide clean, secure, efficient, and well-structured code. Explain architectural decisions concisely.',
    isBuiltIn: true,
  },
  {
    id: 'concise',
    name: 'Ultra Concise',
    content: 'Provide direct, minimal, high-signal answers without conversational filler or unnecessary pleasantries.',
    isBuiltIn: true,
  },
];
