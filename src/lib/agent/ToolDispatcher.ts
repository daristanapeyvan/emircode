import { AgentCapabilities } from '../../types/agent';
import { WebAccessConfig } from '../../types/settings';

export type ParsedActionType =
  | 'read_directory'
  | 'read_file'
  | 'search_code'
  | 'read_git_status'
  | 'read_git_diff'
  | 'propose_create'
  | 'propose_edit'
  | 'propose_delete'
  | 'propose_command'
  | 'ask_question'
  | 'web_search'
  | 'fetch_url'
  | 'finish'
  | 'unknown';

export interface ParsedAction {
  type: ParsedActionType;
  payload: any;
  rawJson: any;
  error?: string;
}

export interface ParseActionContext {
  expectedArtifacts?: string[];
  activeTaskTarget?: string;
}

export class ToolDispatcher {
  static parseActionFromResponse(text: string, context?: ParseActionContext): ParsedAction {
    let jsonContent: any = null;

    // 1. Try markdown code fence ```json ... ```
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      try {
        jsonContent = JSON.parse(fenceMatch[1]);
      } catch {}
    }

    // 2. Direct JSON object fallback
    if (!jsonContent) {
      const braceMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/);
      if (braceMatch) {
        try {
          jsonContent = JSON.parse(braceMatch[0]);
        } catch {}
      }
    }

    // 3. Coder Model Raw Code Block Fallback (Strict Hierarchy)
    if (!jsonContent || typeof jsonContent !== 'object') {
      const codeBlockMatch = text.match(/```([a-zA-Z0-9_\-]+)?\s*\n([\s\S]*?)\n```/);
      if (codeBlockMatch) {
        const lang = (codeBlockMatch[1] || '').toLowerCase();
        const code = codeBlockMatch[2];

        // Step 1: Explicit filepath in text or in code comment
        const explicitPathMatch =
          text.match(/(?:\/\/|<!--|#|\/\*)\s*(?:file(?:path)?|dosya)\s*:\s*([^\s*>\n]+)/i) ||
          text.match(/(?:file(?:path)?|dosya|path)\s*:\s*[`"']?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)[`"']?/i);

        let determinedPath: string | null = null;
        if (explicitPathMatch && explicitPathMatch[1]) {
          determinedPath = explicitPathMatch[1].trim().replace(/^['"`]+|['"`]+$/g, '');
        }

        // Step 2: Active Task Expected Artifact (if exactly 1 unambiguous artifact expected)
        if (!determinedPath) {
          if (context?.activeTaskTarget) {
            determinedPath = context.activeTaskTarget;
          } else if (context?.expectedArtifacts && context.expectedArtifacts.length === 1) {
            determinedPath = context.expectedArtifacts[0];
          }
        }

        // Step 3: If no explicit or verified artifact target, DO NOT GUESS - STOP!
        if (determinedPath) {
          const cleanPath = determinedPath.replace(/\\/g, '/').replace(/^\.\//, '');
          return {
            type: 'propose_create',
            payload: {
              path: cleanPath,
              content: code,
              reason: 'Coder modeli doğrudan kod bloğu aktarımı (Doğrulanmış hedef dosya)',
            },
            rawJson: { action: 'propose_create', path: cleanPath, content: code },
          };
        } else {
          return {
            type: 'unknown',
            payload: null,
            rawJson: null,
            error:
              'Ham kod bloğu algılandı ancak hedef dosya yolu belirlenemedi. Güvenlik gereği tahmin yapılmadı. Lütfen dosya yolunu açıkça belirtin (ör. `// filepath: src/index.html`).',
          };
        }
      }

      // 4. Raw HTML Document Fallback (without code fence)
      const htmlDocMatch = text.match(/(<!DOCTYPE\s+html[\s\S]*<\/html>|<html[\s\S]*<\/html>)/i);
      if (htmlDocMatch) {
        const code = htmlDocMatch[0].trim();
        let determinedPath =
          context?.activeTaskTarget ||
          (context?.expectedArtifacts && context.expectedArtifacts[0]) ||
          'index.html';
        const cleanPath = determinedPath.replace(/\\/g, '/').replace(/^\.\//, '');
        return {
          type: 'propose_create',
          payload: {
            path: cleanPath,
            content: code,
            reason: 'Doğrudan HTML belgesi aktarımı (index.html)',
          },
          rawJson: { action: 'propose_create', path: cleanPath, content: code },
        };
      }

      return {
        type: 'unknown',
        payload: null,
        rawJson: null,
        error: 'Model yanıtında geçerli bir JSON eylemi bulunamadı.',
      };
    }

    // CRITICAL SECURITY: Ignore any model self-approval claims!
    delete jsonContent.approved;
    delete jsonContent.token;
    delete jsonContent.authorized;

    const action = String(jsonContent.action || '').trim().toLowerCase();

    switch (action) {
      case 'read_directory': {
        let reqPath = String(jsonContent.path || '').trim();
        if (
          reqPath === 'hedef_klasor' ||
          reqPath === 'hedef_dizin' ||
          reqPath === '.' ||
          reqPath === './'
        ) {
          reqPath = '';
        }
        return {
          type: 'read_directory',
          payload: { path: reqPath },
          rawJson: jsonContent,
        };
      }

      case 'read_file': {
        let reqPath = String(jsonContent.path || '').trim();
        if (
          reqPath === 'hedef_dosya.js' ||
          reqPath === 'hedef_dosya.html' ||
          reqPath === 'olusturulacak_dosya.js'
        ) {
          reqPath =
            context?.activeTaskTarget ||
            (context?.expectedArtifacts && context.expectedArtifacts[0]) ||
            'index.html';
        }
        return {
          type: 'read_file',
          payload: { path: reqPath },
          rawJson: jsonContent,
        };
      }

      case 'search_code':
        return {
          type: 'search_code',
          payload: { query: String(jsonContent.query || '') },
          rawJson: jsonContent,
        };

      case 'read_git_status':
        return {
          type: 'read_git_status',
          payload: {},
          rawJson: jsonContent,
        };

      case 'read_git_diff':
        return {
          type: 'read_git_diff',
          payload: {},
          rawJson: jsonContent,
        };

      case 'propose_create': {
        let reqPath = String(jsonContent.path || '').trim();
        if (
          reqPath === 'olusturulacak_dosya.js' ||
          reqPath === 'olusturulacak_dosya.html' ||
          reqPath === 'hedef_dosya.js' ||
          reqPath === 'hedef_dosya.html' ||
          !reqPath
        ) {
          reqPath =
            context?.activeTaskTarget ||
            (context?.expectedArtifacts && context.expectedArtifacts[0]) ||
            'index.html';
        }
        return {
          type: 'propose_create',
          payload: {
            path: reqPath,
            content: String(jsonContent.content || ''),
            reason: String(jsonContent.reason || 'Yeni dosya oluşturma'),
          },
          rawJson: jsonContent,
        };
      }

      case 'propose_edit': {
        let reqPath = String(jsonContent.path || '').trim();
        if (
          reqPath === 'duzenlenecek_dosya.js' ||
          reqPath === 'duzenlenecek_dosya.html' ||
          reqPath === 'hedef_dosya.js' ||
          reqPath === 'hedef_dosya.html' ||
          !reqPath
        ) {
          reqPath =
            context?.activeTaskTarget ||
            (context?.expectedArtifacts && context.expectedArtifacts[0]) ||
            'index.html';
        }
        return {
          type: 'propose_edit',
          payload: {
            path: reqPath,
            original_chunk: String(jsonContent.original_chunk || ''),
            new_chunk: String(jsonContent.new_chunk || ''),
            reason: String(jsonContent.reason || 'Kod güncellemesi'),
          },
          rawJson: jsonContent,
        };
      }

      case 'propose_delete':
        return {
          type: 'propose_delete',
          payload: {
            path: String(jsonContent.path || ''),
            reason: String(jsonContent.reason || 'Dosya silme'),
          },
          rawJson: jsonContent,
        };

      case 'propose_command':
        return {
          type: 'propose_command',
          payload: {
            binary: String(jsonContent.binary || '').toLowerCase(),
            args: Array.isArray(jsonContent.args) ? jsonContent.args.map(String) : [],
            reason: String(jsonContent.reason || 'Test veya derleme çalıştırma'),
          },
          rawJson: jsonContent,
        };

      case 'ask_question':
        return {
          type: 'ask_question',
          payload: {
            question: String(jsonContent.question || ''),
            options: Array.isArray(jsonContent.options) ? jsonContent.options.map(String) : undefined,
          },
          rawJson: jsonContent,
        };

      case 'web_search':
        return {
          type: 'web_search',
          payload: {
            query: String(jsonContent.query || '').trim(),
          },
          rawJson: jsonContent,
        };

      case 'fetch_url':
        return {
          type: 'fetch_url',
          payload: {
            url: String(jsonContent.url || '').trim(),
          },
          rawJson: jsonContent,
        };

      case 'finish':
        return {
          type: 'finish',
          payload: {
            summary: String(jsonContent.summary || 'Görev tamamlandı.'),
          },
          rawJson: jsonContent,
        };

      default:
        return {
          type: 'unknown',
          payload: jsonContent,
          rawJson: jsonContent,
          error: `Bilinmeyen eylem tipi: ${action}`,
        };
    }
  }

  /**
   * Evaluates if Web Access is strictly authorized for the given mode and configuration.
   */
  static isWebAccessAllowed(
    mode: 'chat' | 'coding',
    config?: { enabled: boolean; chatEnabled: boolean; codingEnabled: boolean }
  ): boolean {
    if (!config || !config.enabled) return false;
    if (mode === 'chat') return !!config.chatEnabled;
    if (mode === 'coding') return !!config.codingEnabled;
    return false;
  }

  /**
   * Derives unified AgentCapabilities matrix based on mode, WebAccessConfig, and workspace Git state.
   */
  static getCapabilities(
    mode: 'chat' | 'coding',
    config?: WebAccessConfig,
    gitAvailable?: boolean
  ): AgentCapabilities {
    const isAllowed = this.isWebAccessAllowed(mode, config);
    return {
      webSearch: isAllowed,
      webFetch: isAllowed,
      git: !!gitAvailable,
    };
  }
}
