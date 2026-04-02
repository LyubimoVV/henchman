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
│   └── error-handler.ts  # Обработка ошибок
├── llm/
│   ├── client.ts         # DeepSeek клиент
│   └── function-calling.ts
├── tools/
│   ├── system/           # System tools
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
