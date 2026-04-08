import type {
  SubagentTask,
  SubagentResult,
  SubagentContext,
  ChatMessage,
  ToolDefinition,
} from './types';
import type { AgentInfo } from './agent/types';
import { toolUseLoop } from './tool-use-loop';
import { logger } from './logger';

function generateId(): string {
  return `subagent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface SubagentOptions {
  agent?: AgentInfo;
  signal?: AbortSignal;
}

export class Subagent {
  private task: SubagentTask;
  private logs: string[];
  private foundFiles: Set<string>;
  private searchCache: Map<string, unknown>;
  private options: SubagentOptions;

  constructor(task: SubagentTask, options: SubagentOptions = {}) {
    this.task = task;
    this.logs = [];
    this.foundFiles = new Set();
    this.searchCache = new Map();
    this.options = options;
  }

  async execute(): Promise<SubagentResult> {
    logger.subagentSpawn(this.task.id, this.task.description);

    if (this.task.tools.length === 0) {
      logger.warn('subagent', 'Subagent has no tools available', { taskId: this.task.id });
    } else {
      logger.info('subagent', 'Subagent tools available', {
        taskId: this.task.id,
        tools: this.task.tools.map(t => t.name),
      });
    }

    try {
      const systemPrompt = this.buildSystemPrompt();
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this.task.description },
      ];

      const result = await toolUseLoop(messages, {
        maxIterations: this.options.agent?.maxIterations ?? 15,
        tools: this.task.tools,
        agent: this.options.agent,
        signal: this.options.signal,
        onToolCall: (name, args) => {
          this.logs.push(`Tool call: ${name}(${JSON.stringify(args)})`);
        },
        onToolResult: (name, result, success) => {
          this.logs.push(`Tool result: ${name} - ${success ? 'success' : 'failed'}`);
          this.trackFoundFiles(name, result, success);
        },
      });

      const status = this.evaluateResult(result.finalContent);
      const taskCompleted = status === 'success';

      logger.subagentComplete(this.task.id, status);
      logger.info('subagent', 'Subagent result details', {
        taskId: this.task.id,
        status,
        taskCompleted,
        contentLength: result.finalContent?.length ?? 0,
        toolCallsCount: result.toolCallsCount,
        filesFound: this.foundFiles.size,
      });

      return {
        taskId: this.task.id,
        status,
        data: result.finalContent,
        taskCompleted,
        filesModified: this.extractModifiedFiles(result.messages),
        logs: this.logs,
        contextOut: {
          lastQuery: this.task.description,
          sharedContext: {
            foundFiles: Array.from(this.foundFiles),
            searchCache: Object.fromEntries(this.searchCache),
          },
        },
      };
    } catch (error) {
      logger.subagentComplete(this.task.id, 'error');

      return {
        taskId: this.task.id,
        status: 'error',
        data: null,
        filesModified: [],
        logs: [...this.logs, `Error: ${(error as Error).message}`],
        contextOut: {},
      };
    }
  }

  private evaluateResult(content: string): 'success' | 'partial' {
    if (!content || content.trim().length === 0) {
      return 'partial';
    }

    const failurePatterns = [
      /i\s+(?:cannot|can't|could not|unable to)\s+(?:find|access|execute|run|determine|perform|complete)/i,
      /no\s+(?:results?|matches?|files?|data|information|changes|diff)\s+found/i,
      /(?:not|n't)\s+(?:available|possible|found|accessible)/i,
    ];

    const lowerContent = content.toLowerCase();
    for (const pattern of failurePatterns) {
      if (pattern.test(content) && lowerContent.length < 300) {
        return 'partial';
      }
    }

    return 'success';
  }

  private buildSystemPrompt(): string {
    const toolNames = this.task.tools.map((t) => t.name).join(', ');
    const hasRagSearch = this.task.tools.some(t => t.name === 'rag_search');
    const hasContentSearch = this.task.tools.some(t => t.name === 'content_search');
    
    const searchHints: string[] = [];
    if (hasRagSearch || hasContentSearch) {
      searchHints.push('## Search Tools (USE THESE FIRST):');
      if (hasContentSearch) {
        searchHints.push(
          '- content_search: FAST exact text/regex search in file contents (like grep).',
          '  - Use for finding specific code, component names, function definitions.',
          '  - ALWAYS use ignoreCase=true for case-insensitive search.',
          '  - Use ONE search with ignoreCase=true instead of multiple case-sensitive searches.',
          '  - Example: content_search({pattern: "UserService", ignoreCase: true, maxResults: 100})',
        );
      }
      if (hasRagSearch) {
        searchHints.push(
          '- rag_search: Semantic search in indexed project files.',
          '  - Use for conceptual searches ("authentication flow", "error handling").',
          '  - Slower than content_search (involves reranking).',
          '  - Returns semantically relevant code even if exact words differ.',
          '  - Describe WHAT code does, not exact text.',
          '  - Example: rag_search({query: "DeepSeekClient API client implementation"})',
          '  - Example: rag_search({query: "database connection pooling logic"})',
        );
      }
      searchHints.push(
        '',
        '## Search Strategy:',
        '1. Start with content_search (fastest) for exact names/patterns',
        '2. Use rag_search for semantic/conceptual queries or when content_search fails',
        '3. Read files only after search narrows down results',
         '4. AVOID redundant searches - one good search is better than many weak ones',
        '',
        '## Task Completion:',
        '- STOP immediately when you have found the requested information',
        '- REPORT your findings clearly: file paths, line numbers, relevant code',
        '- Do NOT continue searching if task is already complete',
        '- If asked to find a class/function/component, provide its location and stop',
        '- Avoid unnecessary iterations - 2-3 successful tool calls should be enough',
      );
    }

    return [
      '# РОЛЬ И КОНТЕКСТ',
      'Ты — автономный агент разработки, работающий в CLI-среде Henchman.',
      'Окружение: Windows. Терминал поддерживает POSIX-утилиты (Git Bash/coreutils).',
      'Задача: выполнить запрос строго в рамках технических ограничений.',
      '',
      '# ЯЗЫК ОТВЕТА',
      '- ВСЕГДА отвечай на ЯЗЫКЕ ЗАПРОСА пользователя.',
      '- Запрос на русском → анализ, комментарии, вывод на русском.',
      '- Запрос на английском → отвечай на английском.',
      '- Исключение: код, логи, технические идентификаторы — как есть.',
      '',
      '# ЯЗЫК КОНТЕНТА ФАЙЛОВ (КРИТИЧНО)',
      '- Если пользователь запрашивает создание/редактирование файла на русском — генерируй СОДЕРЖИМОЕ файла на русском.',
      '- Исключения: код, команды, технические термины, JSON-ключи, ссылки — оставляй на английском.',
      '- Примеры:',
      '  ✓ Запрос: "создай файл readme.md с описанием" → содержимое на русском',
      '  ✓ Запрос: "создай config.json" → JSON-ключи на английском, комментарии на русском (если нужны)',
      '',
      `## Available Tools: ${toolNames}`,
      '',
      '# ЖЁСТКИЕ ОГРАНИЧЕНИЯ (БЕЗ ИСКЛЮЧЕНИЙ)',
      '1. РАЗРЕШЁННЫЕ КОМАНДЫ ДЛЯ BASH: ls, dir, pwd, echo, cat, head, tail, npm, node, npx, yarn, pnpm, git, gh, grep, find, rg, fd, mkdir, touch.',
      '2. Используй ТОЛЬКО инструменты из списка выше. НЕ пытайся вызвать delegate, fan-out, chain, router.',
      '3. НЕ трать итерации на перебор вариантов чтения одного файла. Получил нужные данные — сразу формируй ответ.',
      '',
      '# ЧТЕНИЕ ФАЙЛОВ (КРИТИЧНО)',
      '- Для чтения файлов ВСЕГДА используй: `bash {"command": "cat <путь>"}`.',
      '- Если доступен read_file — используй его.',
      '- НЕ вызывай `cat` как отдельный инструмент — это вызовет ошибку "Tool not found".',
      '- Примеры:',
      '  ✓ `bash {"command": "cat .github/workflows/pr-review.yml"}`',
      '  ✓ `bash {"command": "head -n 50 src/index.ts"}`',
      '  ✗ `cat {"path": "..."}` — НЕЛЬЗЯ (cat не является инструментом)',
      '  ✗ `type файл` — НЕЛЬЗЯ (Windows-команда)',
      '  ✗ `powershell Get-Content ...` — НЕЛЬЗЯ',
      '',
      '# ПУТИ И СИНТАКСИС',
      '- Используй ОТНОСИТЕЛЬНЫЕ пути: `.gitignore`, `src/index.ts`.',
      '- НЕ используй абсолютные пути типа `C:\\project_demo\\...` или `C:/project_demo/...`.',
      '- Используй ТОЛЬКО прямые слеши (/) в путях: `src/main/java/...`.',
      '- НЕ используй обратные слеши (\\) в bash-командах.',
      '- НЕ используй `cd`, `&&`, `|`, `;` в одной команде — выполняй по одному действию за вызов.',
      '- Если путь содержит пробелы — бери его в кавычки: `cat "path/with space/file.txt"`.',
      '',
      '# ОБРАБОТКА ОШИБОК BASH',
      '- При получении `Command not allowed` — НЕМЕДЛЕННО переключайся на разрешённый аналог:',
      '  • type/more/findstr → `bash {"command": "cat <путь>"}`',
      '  • powershell → `bash {"command": "cat <путь>"}` или `read_file`',
      '  • cd ... && dir → `ls` или `dir` (без cd)',
      '- ЗАПРЕЩЕНО повторять команду, которая вернула ошибку. Считай её недоступной до конца сессии.',
      '- Если не знаешь путь к файлу — сначала найди его через `find` или `glob_search`, затем читай через `bash {"command": "cat <путь>"}`.',
      '- Одно попадание в "Command not allowed" = потерянная итерация. Минимизируй ошибки.',
      '',
      '# ПРОСТЫЕ ЗАДАЧИ',
      '- ЕСЛИ задача — "прочитать файл": используй `read_file` или `bash {"command": "cat <путь>"}` и НЕМЕДЛЕННО верни результат.',
      '- НЕ создавай дополнительные вызовы для "уточнения пути" или "проверки существования" — просто читай файл.',
      '- ЕСЛИ задача — "найти файл": один glob_search или find → верни результат → СТОП.',
      '',
      '# РАБОТА С ФАЙЛАМИ (КРИТИЧНО)',
      '- ЕСЛИ задача — "создать файл", "сохранить", "сгенерировать файл" — ОБЯЗАТЕЛЬНО используй `file_write {"path": "...", "content": "..."}`.',
      '- НЕ выводи контент файла просто в чат, если задача — создать файл.',
      '- После успешного сохранения напиши: файл сохранён: <путь>.',
      '- Пример:',
      '  ✓ `file_write {"path": "CHANGELOG.md", "content": "# Changelog\\n..."}`',
      '  ✗ вывод "# Changelog\\n..." в чат — НЕЛЬЗЯ, если просят создать файл',
      '',
      '# ГЕНЕРАЦИЯ CHANGELOG / ЖУРНАЛА ИЗМЕНЕНИЙ',
      '1. Сначала проанализируй историю:',
      '   - `git log --oneline -20` — получить список коммитов',
      '   - `git diff HEAD~5 --name-only` — увидеть изменённые файлы',
      '2. Сгруппируй изменения по категориям:',
      '   - Новые функции → "### Добавлено"',
      '   - Исправления ошибок → "### Исправлено"',
      '   - Изменения интерфейса/поведения → "### Изменено"',
      '   - Обновления зависимостей → "### Обновлено"',
      '3. Сформируй контент на основе РЕАЛЬНЫХ данных git, а не шаблона.',
      '4. Если изменений нет — явно укажи: "Изменений с последней версии не обнаружено".',
      '',
      '## Context:',
      `- Project Path: ${this.task.contextIn.projectPath}`,
      this.task.contextIn.gitBranch ? `- Git Branch: ${this.task.contextIn.gitBranch}` : '',
      this.task.contextIn.techStack ? `- Tech Stack: ${this.task.contextIn.techStack}` : '',
      '',
      ...searchHints,
      '',
      '# ШАБЛОН ДЕЙСТВИЙ',
      '1. Проанализируй запрос.',
      '2. Выбери минимальный набор разрешённых команд.',
      '3. Выполни → получи результат → проверь на ошибки.',
      '4. Если ошибка валидации: переключись на `bash {"command": "cat <файл>"}` без повторных попыток старых команд.',
      '5. Сформируй структурный ответ.',
      '',
      '## Instructions:',
      '- START with search tools (content_search or rag_search) to locate relevant code.',
      '- Use content_search with ignoreCase=true for comprehensive results.',
      '- AVOID multiple similar searches - combine parameters when possible.',
      '- Read files via bash cat or read_file only AFTER you have identified relevant locations.',
      '- Be concise and focused on the specific task.',
      '- Report your findings clearly with file paths and line references.',
      '- If you cannot complete the task, explain why.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private trackFoundFiles(toolName: string, result: unknown, success: boolean): void {
    if (!success || !result) return;

    try {
      if (toolName === 'list_files') {
        const res = result as { files?: unknown; result?: { files?: unknown } };
        const files = res.files ?? res.result?.files;
        if (Array.isArray(files)) {
          files.forEach((f: unknown) => {
            if (typeof f === 'string') this.foundFiles.add(f);
          });
        }
      }
      
      if (toolName === 'content_search') {
        const res = result as { results?: unknown; result?: { results?: unknown } };
        const results = res.results ?? res.result?.results;
        if (Array.isArray(results)) {
          results.forEach((r: unknown) => {
            if (r && typeof r === 'object' && 'file' in r) {
              const file = (r as { file: unknown }).file;
              if (typeof file === 'string') this.foundFiles.add(file);
            }
          });
        }
      }
      
      if (toolName === 'read_file') {
        const res = result as { path?: unknown; result?: { path?: unknown } };
        const path = res.path ?? res.result?.path;
        if (typeof path === 'string') {
          this.foundFiles.add(path);
        }
      }
    } catch {
      // Silently ignore tracking errors
    }
  }

  private extractModifiedFiles(messages: ChatMessage[]): string[] {
    const files: Set<string> = new Set();

    for (const message of messages) {
      if (message.role === 'tool' && message.content) {
        try {
          const content = JSON.parse(message.content) as { path?: string; filePath?: string };
          if (content.path) files.add(content.path);
          if (content.filePath) files.add(content.filePath);
        } catch {
          // Not JSON, skip
        }
      }
    }

    return Array.from(files);
  }
}

export function createSubagent(
  description: string,
  tools: ToolDefinition[],
  context: SubagentContext,
  options: SubagentOptions = {},
): Subagent {
  const task: SubagentTask = {
    id: generateId(),
    description,
    tools,
    contextIn: context,
  };

  return new Subagent(task, options);
}
