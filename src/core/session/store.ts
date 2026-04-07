import type { Session, SessionStatus } from './types';
import type { ChatMessage } from '../types';
import { logger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const SESSIONS_DIR = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.henchman', 'sessions');

function sessionFilePath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

function serializeSession(session: Session): string {
  return JSON.stringify({
    id: session.id,
    parentId: session.parentId ?? null,
    agentName: session.agentName,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages.map(m => ({
      role: m.role,
      content: m.content,
      toolCallId: m.toolCallId ?? null,
      toolCalls: m.toolCalls ?? null,
    })),
  }, null, 2);
}

class SessionStore {
  private sessions: Map<string, Session> = new Map();

  private ensureDir(): void {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  private persist(session: Session): void {
    try {
      this.ensureDir();
      fs.writeFileSync(sessionFilePath(session.id), serializeSession(session), 'utf-8');
    } catch (error) {
      logger.debug('main', 'Failed to persist session', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  create(options: { agentName: string; parentId?: string }): Session {
    const session: Session = {
      id: generateSessionId(),
      parentId: options.parentId,
      agentName: options.agentName,
      messages: [],
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    this.persist(session);
    logger.debug('main', 'Session created', { sessionId: session.id, agent: options.agentName });
    return session;
  }

  get(id: string): Session | undefined {
    if (this.sessions.has(id)) {
      return this.sessions.get(id);
    }
    return this.loadFromDisk(id);
  }

  addMessage(id: string, message: ChatMessage): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.messages.push(message);
    session.updatedAt = Date.now();
    this.persist(session);
    return session;
  }

  setStatus(id: string, status: SessionStatus): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.status = status;
    session.updatedAt = Date.now();
    this.persist(session);
    return session;
  }

  getChildren(parentId: string): Session[] {
    const children: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.parentId === parentId) {
        children.push(session);
      }
    }
    return children;
  }

  listActive(): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  delete(id: string): boolean {
    const removed = this.sessions.delete(id);
    try {
      const fp = sessionFilePath(id);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
      }
    } catch { /* ignore */ }
    return removed;
  }

  private loadFromDisk(id: string): Session | undefined {
    try {
      const fp = sessionFilePath(id);
      if (!fs.existsSync(fp)) return undefined;
      const raw = fs.readFileSync(fp, 'utf-8');
      const data = JSON.parse(raw) as {
        id: string;
        parentId: string | null;
        agentName: string;
        status: SessionStatus;
        createdAt: number;
        updatedAt: number;
        messages: Array<{
          role: string;
          content: string;
          toolCallId: string | null;
          toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
        }>;
      };

      const session: Session = {
        id: data.id,
        parentId: data.parentId ?? undefined,
        agentName: data.agentName,
        status: data.status,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        messages: data.messages.map(m => {
          const msg: ChatMessage = {
            role: m.role as ChatMessage['role'],
            content: m.content,
          };
          if (m.toolCallId) msg.toolCallId = m.toolCallId;
          if (m.toolCalls) msg.toolCalls = m.toolCalls;
          return msg;
        }),
      };

      this.sessions.set(session.id, session);
      return session;
    } catch {
      return undefined;
    }
  }
}

export const sessionStore = new SessionStore();
