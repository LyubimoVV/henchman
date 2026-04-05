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
| `/exit` | Выход |

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
│   │   └── delegate.ts   # Tool для делегирования
│   ├── mcp/              # MCP tools
│   └── rag/              # RAG tools
├── rag/
│   ├── embedder.ts       # Ollama embeddings
│   ├── chunker.ts        # Разбивка на чанки
│   ├── vector-store.ts   # Векторное хранилище
│   ├── indexer.ts        # Индексация проекта
│   ├── retriever.ts      # Поиск + rerank
│   └── rerank-client.ts  # Rerank сервис
├── review/               # Code review module
│   ├── index.ts          # Entry point
│   ├── types.ts          # Типы review
│   ├── diff-fetcher.ts   # Получение diff
│   ├── analyzer.ts       # LLM анализ
│   └── formatter.ts      # Форматирование вывода
└── commands/
    └── *.ts              # Команды CLI
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
