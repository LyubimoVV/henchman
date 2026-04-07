# Henchman

AI Developer Assistant с RAG, MCP и субагентами.

## Архитектура

```
┌─────────────────────────────────────────────────────┐
│                    CLI Layer                         │
│            (REPL / One-shot / Commands)              │
└──────────────────────┬──────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                 MAIN AGENT (Orchestrator)            │
│  - Intent extraction via LLM                        │
│  - Tool selection (function calling)                │
│  - Subagent lifecycle management                    │
│  - Delegation patterns (fan-out, chain, router)     │
└────┬──────────┬──────────┬──────────────────────────┘
     │          │          │
     ▼          ▼          ▼
┌─────────┐ ┌────────┐ ┌───────────┐
│ RAG     │ │ MCP    │ │ System    │
│ Tools   │ │ Tools  │ │ Tools     │
└─────────┘ └────────┘ └───────────┘
```

## Возможности

- **RAG**: Семантический поиск по документации проекта (Ollama embeddings + rerank)
- **MCP**: Git-интеграция (branch, diff), работа с файлами
- **Субагенты**: Изолированные агенты для специфических задач
- **Function Calling**: LLM выбирает инструменты по смыслу запроса
- **REPL / One-shot**: Интерактивный режим или разовый запрос
- **Паттерны делегирования**: Fan-Out, Chain, Router

## Паттерны делегирования

Delegate tool позволяет orchestrator'у создавать субагентов для параллельного или последовательного выполнения задач.

**Важно:** Субагенты работают в изоляции и НЕ имеют доступа к delegate tool (защита от рекурсии).

| Паттерн | Описание | Use-case |
|---------|----------|----------|
| **fan-out** | Параллельное выполнение | Анализ всех файлов в директории |
| **chain** | Последовательная передача результатов | Чтение → Анализ → Генерация |
| **router** | Маршрутизация по условию | Выбор агента по типу запроса |

### Fan-Out (Параллельное выполнение)

```json
{
  "pattern": "fan-out",
  "config": {
    "tasks": [
      { "description": "Find TODOs in src/", "tools": ["rag_search", "read_file"] },
      { "description": "Find FIXMEs in src/", "tools": ["rag_search", "read_file"] }
    ],
    "concurrency": 2,
    "failFast": false
  }
}
```

### Chain (Последовательная цепочка)

```json
{
  "pattern": "chain",
  "config": {
    "tasks": [
      { "description": "Read package.json", "tools": ["read_file"] },
      { "description": "Extract dependencies", "tools": ["analyze"] },
      { "description": "Check for updates", "tools": ["bash"] }
    ],
    "passResults": true
  }
}
```

### Router (Маршрутизация по условию)

```json
{
  "pattern": "router",
  "config": {
    "routes": [
      {
        "name": "git",
        "description": "Git operations: commit, branch, diff",
        "task": { "description": "Execute git command", "tools": ["git_branch", "git_diff"] }
      },
      {
        "name": "files",
        "description": "File operations: read, write, list",
        "task": { "description": "File operation", "tools": ["read_file", "write_file"] }
      }
    ],
    "input": "Show me the current branch"
  }
}
```

**Важно:**
- Субагенты работают в **изоляции** и НЕ имеют доступа к delegate tool
- В `tasks.tools` указывайте только прямые инструменты (без delegate)
- Субагенты не могут вкладывать делегирования (защита от рекурсии)

## DAG-планирование делегирования

### Архитектура

Новая система делегирования использует комбинацию DAG-планирования + Resource Reservation + Strict Exit Criteria:

```
User Request
     ↓
[TaskPlanner] Декомпозиция цели в SubTask[] с DAG-зависимостями
     ↓
[FileResourceManager] Резервирование путей, кэш, блокировки
     ↓
[AgentDispatcher] Fan-out задач с проверкой scope boundaries
     ↓
[VerificationGate] Проверка coverage(scope) и статусов
     ↓
[ExitController] maxDepth, maxRetries, timeout, earlyExit
     ↓
Aggregated Result
```

### Компоненты

| Компонент | Назначение |
|-----------|------------|
| **TaskPlanner** | Декомпозиция цели в SubTask[] с явным scope и dependencies |
| **FileResourceManager** | Управление reservedPaths, resultCache, lockTimeout |
| **AgentDispatcher** | Fan-out задач, передача только разрешённого scope |
| **VerificationGate** | Проверка coverage(scope) и status перед агрегацией |
| **ExitController** | Физические ограничения: maxDepth, maxRetries, timeout |

### Scope Definition

```typescript
scope: {
  include: string[];    // Глобы/пути: ['src/auth/*', 'src/middleware/*.ts']
  exclude?: string[];   // Исключения: ['**/*.test.ts', 'node_modules/**']
  fileTypes?: string[]; // Расширения: ['.ts', '.tsx', '.js']
}
```

### Retry стратегии

| Ошибка | Стратегия | Описание |
|--------|-----------|----------|
| `TIMEOUT` | `RETRY_SAME_PLAN` | Повтор с теми же параметрами |
| `FS_LOCK` | `RETRY_SAME_PLAN` | Повтор после освобождения блокировки |
| `EMPTY_RESULT` | `RETRY_WITH_HINT` | Повтор + уточняющий промпт |
| `INVALID_SCOPE` | `REPLAN` | Полный пересмотр плана |
| `CRITICAL_ERROR` | `FAIL_FAST` | Немедленная остановка |

### Exit Criteria

```typescript
const DEFAULT_EXIT_CRITERIA = {
  maxDepth: 3,              // Максимальная глубина делегирования
  maxRetries: 2,            // Максимум повторных попыток
  timeout: 120000,          // Общий таймаут (2 минуты)
  earlyExitOnCacheHit: true // Ранний выход при попадании в кэш
};
```

### Использование

```typescript
const manager = new DelegationManager(options);

// Новый API с DAG-планированием
const result = await manager.executeWithPlan('Analyze authentication flow');

// Legacy API (сохранён для обратной совместимости)
const results = await manager.execute('fan-out', config);
```

### Преимущества

1. **Избежание дублирования** — Resource Reservation + Scope Validation
2. **Контроль выполнения** — VerificationGate + ExitController
3. **Гибкость** — Гибридное планирование (эвристика + LLM)
4. **Надёжность** — Retry стратегии с exponential backoff
5. **Обратная совместимость** — Legacy wrapper для старого API

## Установка

```bash
npm install
cp .env.example .env
# Отредактируйте .env, добавьте DEEPSEEK_API_KEY
```

## Требования

- Node.js 18+
- Ollama с моделью `nomic-embed-text`
- Python rerank-сервис (опционально)
- DeepSeek API ключ

## Использование

### REPL режим

```bash
npm run dev
# или
tsx src/index.ts
```

### One-shot режим

```bash
tsx src/index.ts "Что делает этот проект?" -p /path/to/project
```

### Команды в REPL

| Команда | Описание |
|---------|----------|
| `/help [query]` | Поиск по документации проекта |
| `/index` | Переиндексация проекта |
| `/tools` | Список доступных инструментов |
| `/status` | Текущее состояние |
| `/tickets` | Список тикетов поддержки |
| `/support <ticket_id>` | Сессия поддержки по тикету |
| `/exit` | Выход |

## AI Support Assistant

AI-ассистент для технической поддержки пользователей с RAG и контекстом тикетов.

### Возможности

- **RAG поиск** по документации продукта
- **Контекст тикета**: категория, приоритет, история переписки
- **Контекст пользователя**: план, опыт, компания
- **Персонализация ответов** по уровню опыта (junior/middle/senior)

### Использование

```bash
# Запуск REPL
npm run dev

# Список тикетов
/tickets

# Начать сессию поддержки
/support TKT-001
```

### Пример сессии

```
> /support TKT-001

════════════════════════════════════════════════════════════
📋 Support Session
════════════════════════════════════════════════════════════
Ticket: TKT-001 - Не работает авторизация через DeepSeek API
Status: open | Priority: high
User: Иван Петров (ivan.petrov@company.ru)
Plan: free
════════════════════════════════════════════════════════════

> Почему не работает авторизация?

Answer:
Основываясь на вашем тикете TKT-001, проблема с авторизацией 
через DeepSeek API может быть вызвана несколькими причинами...

> /done

✓ Support session closed
```

### Данные

Тикеты и пользователи хранятся в JSON файлах:
- `data/users.json` — профили пользователей
- `data/tickets.json` — тикеты поддержки

### MCP Tools

| Tool | Описание |
|------|----------|
| `get_ticket` | Получить тикет по ID с информацией о пользователе |
| `get_user` | Получить профиль пользователя |
| `list_tickets` | Список тикетов с фильтрами |

## AI Code Review

Автоматическое ревью кода с использованием RAG и LLM.

### Локальный запуск

```bash
# Ревью изменений относительно main
henchman review

# Ревью относительно конкретной ветки
henchman review --base develop

# Ревью PR (требуется gh CLI)
henchman review --pr 123

# GitHub формат для CI
henchman review --format github --output review.md
```

### Опции review

| Опция | Описание |
|-------|----------|
| `--base <branch>` | Базовая ветка (default: main) |
| `--head <branch>` | Целевая ветка (default: HEAD) |
| `--pr <number>` | Номер PR для ревью |
| `--format <type>` | Формат вывода: cli \| github |
| `--output <file>` | Записать результат в файл |
| `--no-rag` | Отключить RAG контекст |

### Подключение к другому проекту

Henchman использует reusable workflow. Для подключения AI Code Review к любому репозиторию:

**1. Создать workflow в целевом проекте:**

Файл `.github/workflows/pr-review.yml`:
```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    uses: LyubimoVV/henchman/.github/workflows/pr-review.yml@master
    with:
      pr_number: ${{ github.event.pull_request.number }}
      head_sha: ${{ github.event.pull_request.head.sha }}
    secrets: inherit
```

**2. Добавить секреты:**

В GitHub репозитории → Settings → Secrets and variables → Actions:
- `DEEPSEEK_API_KEY` — API ключ DeepSeek (обязательно)
- `DEEPSEEK_BASE_URL` — URL API (опционально, по умолчанию https://api.deepseek.com/v1)
- `DEEPSEEK_MODEL` — модель (опционально, по умолчанию deepseek-chat)

**3. Готово!**

При создании/обновлении PR автоматически запустится AI Code Review.

### Опции reusable workflow

| Input | Описание | Обязательно |
|-------|----------|-------------|
| `pr_number` | Номер PR | ✅ |
| `head_sha` | SHA коммита | ✅ |
| `repository` | Репозиторий (owner/repo) | ❌ (по умолчанию текущий) |
| `use_rag` | Включить RAG контекст | ❌ (по умолчанию true) |

### GitHub Actions (локальный henchman)

Для запуска review внутри самого henchman:

```yaml
# .github/workflows/pr-review.yml
on:
  pull_request:
    types: [opened, synchronize]
```

Результаты:
- **PR комментарий** с детальным ревью
- **Annotations** на конкретные строки кода
- **Check Run** со статусом (✅/⚠️/❌)

### Кэширование RAG (опциональ)

 В CI индекс кэшируется для ускорения:В CI индекс кэшируется для ускорения:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.henchman
    key: rag-index-${{ hashFiles('**/*.ts') }}
```

### Типы проблем

| Тип | Описание |
|-----|----------|
| 🐛 **Bug** | Потенциальные баги, null pointer, race conditions |
| 🏗️ **Architecture** | Нарушения SOLID, coupling, missing abstractions |
| 💡 **Recommendation** | Best practices, производительность, читаемость |

### Severity уровни

| Уровень | Описание |
|---------|----------|
| 🔴 **Critical** | Блокирует мёрдж |
| 🟡 **Warning** | Требует внимания |
| 🔵 **Info** | Рекомендации |

## Структура проекта

```
src/
├── index.ts              # Entry point
├── cli/
│   ├── repl.ts           # REPL-режим
│   ├── oneshot.ts        # One-shot режим
│   └── review.ts         # Code review CLI
├── config/
│   └── index.ts          # Загрузка конфигурации
├── core/
│   ├── orchestrator.ts   # Главный агент
│   ├── subagent.ts       # Субагенты
│   ├── tool-registry.ts  # Реестр инструментов
│   ├── tool-executor.ts  # Выполнение инструментов
│   ├── tool-use-loop.ts  # Итеративный Tool Use Loop
│   ├── context.ts        # Контекст разговора
│   ├── types.ts          # Типы
│   ├── logger.ts         # Логгер
│   ├── error-handler.ts  # Обработка ошибок
│   └── delegation/       # Паттерны делегирования
│       ├── types.ts       # Типы делегирования
│       ├── base.ts        # Базовый класс executor
│       ├── fan-out.ts     # Параллельное выполнение
│       ├── chain.ts       # Последовательная цепочка
│       ├── router.ts      # Маршрутизация по условию
│       ├── planner.ts     # DAG-планирование задач
│       ├── dispatcher.ts  # Диспетчеризация агентов
│       ├── resource-manager.ts    # Управление ресурсами
│       ├── exit-controller.ts     # Контроль выхода
│       ├── verification.ts        # Верификация результатов
│       ├── manager.ts     # Фасад для делегирования
│       └── index.ts       # Экспорт модуля
├── llm/
│   ├── client.ts         # DeepSeek клиент
│   └── function-calling.ts
├── tools/
│   ├── system/           # System tools
│   │   ├── bash.ts
│   │   ├── file-read.ts
│   │   ├── file-write.ts
│   │   ├── find-files.ts
│   │   ├── content-search.ts  # Поиск по содержимому файлов
│   │   └── delegate.ts   # Tool для делегирования
│   ├── mcp/              # MCP tools
│   │   ├── git-*.ts      # Git tools
│   │   ├── get-ticket.ts # Support ticket tool
│   │   ├── get-user.ts   # Support user tool
│   │   └── list-tickets.ts
│   └── rag/              # RAG tools
├── rag/
│   ├── embedder.ts       # Ollama embeddings
│   ├── chunker.ts        # Разбивка на чанки
│   ├── vector-store.ts   # Векторное хранилище
│   ├── indexer.ts        # Индексация проекта
│   ├── retriever.ts      # Поиск + rerank
│   └── rerank-client.ts  # Rerank сервис
├── support/              # Support assistant module
│   ├── index.ts          # Entry point
│   ├── types.ts          # User, Ticket types
│   ├── data-store.ts     # JSON data loader
│   ├── support-agent.ts  # Agent with RAG
│   └── prompts.ts        # System prompts
├── review/               # Code review module
│   ├── index.ts          # Entry point
│   ├── types.ts          # Типы review
│   ├── diff-fetcher.ts   # Получение diff
│   ├── analyzer.ts       # LLM анализ
│   └── formatter.ts      # Форматирование вывода
└── commands/
    └── *.ts              # Команды CLI
data/
├── users.json            # Пользователи поддержки
└── tickets.json          # Тикеты поддержки
templates/
└── pr-review-caller.yml  # Шаблон workflow для подключения к другим проектам
```

## Конфигурация (.env)

```env
DEEPSEEK_API_KEY=your_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text

RERANK_URL=http://localhost:8000/rerank

LOG_LEVEL=info
```

## Rerank-сервис

Ожидается REST API:

```http
POST /rerank
Content-Type: application/json

{
  "query": "search query",
  "documents": ["doc1", "doc2", ...]
}

Response:
{
  "results": [
    { "index": 0, "score": 0.95, "document": "doc1" },
    ...
  ]
}
```

## Логирование

Цветовая дифференциация:
- `main` (cyan) — orchestrator, основной flow
- `subagent` (green) — субагенты
- `tool` (yellow) — вызовы tools
- `rag` (magenta) — RAG операции
- `mcp` (blue) — MCP коммуникации
- `error` (red) — ошибки

Включить debug: `--debug` или `LOG_LEVEL=debug`

## Разработка

```bash
npm run dev          # Запуск в dev-режиме
npm run build        # Сборка
npm run typecheck   # Проверка типов
npm run test         # Тесты
```

```
