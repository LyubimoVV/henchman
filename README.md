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

## Структура проекта

```
src/
├── index.ts              # Entry point
├── cli/
│   ├── repl.ts           # REPL-режим
│   └── oneshot.ts        # One-shot режим
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
└── commands/
    └── *.ts              # Команды CLI
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
