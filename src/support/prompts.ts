import type { Ticket, User, SupportContext } from './types';
import type { RetrievedChunk } from '../core/types';

export function buildSystemPrompt(context: SupportContext): string {
  const parts: string[] = [];

  parts.push(getBasePrompt());

  if (context.ticket) {
    parts.push(buildTicketContext(context.ticket));
  }

  if (context.user) {
    parts.push(buildUserContext(context.user));
  }

  if (context.ragContext) {
    parts.push(buildRagContext(context.ragContext));
  }

  return parts.join('\n\n');
}

function getBasePrompt(): string {
  return `Ты — ассистент технической поддержки DeepSeek CLI.

Твоя задача:
- Отвечать на вопросы пользователей о продукте
- Учитывать контекст тикета и пользователя
- Использовать информацию из документации (RAG)
- Давать конкретные, практические советы

Правила ответов:
1. Начинай с обращения к пользователю по имени (например: "Здравствуйте, Иван!" или "Иван,")
2. Отвечай на русском языке
3. Будь кратким, но информативным
4. Приводи примеры команд/кода когда уместно
5. Если информации недостаточно — честно скажи
6. Учитывай опыт пользователя (junior/middle/senior)
7. Ссылайся на конкретные секции документации если есть

Формат ответа:
- Обращение по имени
- Прямой ответ на вопрос
- Детали/примеры
- Следующий шаг если уместно`;
}

function buildTicketContext(ticket: Ticket): string {
  const lines: string[] = ['## Контекст тикета'];

  lines.push(`**ID:** ${ticket.id}`);
  lines.push(`**Тема:** ${ticket.subject}`);
  lines.push(`**Статус:** ${ticket.status}`);
  lines.push(`**Приоритет:** ${ticket.priority}`);
  lines.push(`**Категория:** ${ticket.category}`);
  lines.push(`**Создан:** ${ticket.createdAt}`);

  if (ticket.resolvedAt) {
    lines.push(`**Решён:** ${ticket.resolvedAt}`);
  }

  lines.push('\n**История переписки:**');
  ticket.messages.forEach((msg) => {
    const from = msg.from === 'user' ? '👤 Пользователь' : '🛠️ Поддержка';
    lines.push(`${from}: ${msg.text}`);
  });

  if (Object.keys(ticket.metadata).length > 0) {
    lines.push('\n**Метаданные:**');
    Object.entries(ticket.metadata).forEach(([key, value]) => {
      if (value) lines.push(`- ${key}: ${value}`);
    });
  }

  return lines.join('\n');
}

function buildUserContext(user: User): string {
  const lines: string[] = ['## Информация о пользователе'];

  lines.push(`**Имя:** ${user.name}`);
  lines.push(`**Email:** ${user.email}`);
  lines.push(`**Тариф:** ${user.plan}`);
  lines.push(`**Опыт:** ${user.metadata.experience}`);

  if (user.metadata.company) {
    lines.push(`**Компания:** ${user.metadata.company}`);
  }

  const expNote =
    user.metadata.experience === 'junior'
      ? 'Давай более подробные объяснения и примеры.'
      : user.metadata.experience === 'senior'
        ? 'Можно использовать технические термины без объяснений.'
        : 'Обычный уровень детализации.';

  lines.push(`\n_Примечание: ${expNote}_`);

  return lines.join('\n');
}

function buildRagContext(ragContext: string): string {
  return `## Релевантная документация

${ragContext}

_Используй эту информацию для точных ответов._`;
}

export function formatRagChunks(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'Нет релевантной документации.';
  }

  const lines: string[] = [];

  chunks.forEach((chunk) => {
    lines.push(`### ${chunk.filePath} (строки ${chunk.metadata.startLine}-${chunk.metadata.endLine})`);
    lines.push('```');
    lines.push(chunk.content.substring(0, 800));
    lines.push('```');
    lines.push('');
  });

  return lines.join('\n');
}
