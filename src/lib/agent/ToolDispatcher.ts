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
  | 'finish'
  | 'unknown';

export interface ParsedAction {
  type: ParsedActionType;
  payload: any;
  rawJson: any;
  error?: string;
}

export class ToolDispatcher {
  static parseActionFromResponse(text: string): ParsedAction {
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

    if (!jsonContent || typeof jsonContent !== 'object') {
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
      case 'read_directory':
        return {
          type: 'read_directory',
          payload: { path: String(jsonContent.path || '') },
          rawJson: jsonContent,
        };

      case 'read_file':
        return {
          type: 'read_file',
          payload: { path: String(jsonContent.path || '') },
          rawJson: jsonContent,
        };

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

      case 'propose_create':
        return {
          type: 'propose_create',
          payload: {
            path: String(jsonContent.path || ''),
            content: String(jsonContent.content || ''),
            reason: String(jsonContent.reason || 'Yeni dosya oluşturma'),
          },
          rawJson: jsonContent,
        };

      case 'propose_edit':
        return {
          type: 'propose_edit',
          payload: {
            path: String(jsonContent.path || ''),
            original_chunk: String(jsonContent.original_chunk || ''),
            new_chunk: String(jsonContent.new_chunk || ''),
            reason: String(jsonContent.reason || 'Kod güncellemesi'),
          },
          rawJson: jsonContent,
        };

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
}
