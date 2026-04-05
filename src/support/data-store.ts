import { readFile } from 'fs/promises';
import { join } from 'path';
import type { User, Ticket, UsersData, TicketsData, TicketStatus, TicketCategory } from './types';
import { logger } from '../core/logger';

class DataStore {
  private users: Map<string, User> = new Map();
  private tickets: Map<string, Ticket> = new Map();
  private dataPath: string;
  private loaded: boolean = false;

  constructor(dataPath?: string) {
    this.dataPath = dataPath ?? join(process.cwd(), 'data');
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) return;

    try {
      const [usersData, ticketsData] = await Promise.all([
        readFile(join(this.dataPath, 'users.json'), 'utf-8'),
        readFile(join(this.dataPath, 'tickets.json'), 'utf-8'),
      ]);

      const users: UsersData = JSON.parse(usersData);
      const tickets: TicketsData = JSON.parse(ticketsData);

      users.users.forEach((user) => this.users.set(user.id, user));
      tickets.tickets.forEach((ticket) => this.tickets.set(ticket.id, ticket));

      this.loaded = true;
      logger.debug('system', 'DataStore loaded', {
        users: this.users.size,
        tickets: this.tickets.size,
      });
    } catch (error) {
      logger.error('system', 'Failed to load data store', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getUser(userId: string): Promise<User | null> {
    await this.loadIfNeeded();
    return this.users.get(userId) ?? null;
  }

  async getTicket(ticketId: string): Promise<Ticket | null> {
    await this.loadIfNeeded();
    return this.tickets.get(ticketId) ?? null;
  }

  async getTicketWithUser(ticketId: string): Promise<{ ticket: Ticket; user: User | null } | null> {
    await this.loadIfNeeded();
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return null;

    const user = this.users.get(ticket.userId) ?? null;
    return { ticket, user };
  }

  async listTickets(filters?: {
    status?: TicketStatus;
    category?: TicketCategory;
    userId?: string;
  }): Promise<Ticket[]> {
    await this.loadIfNeeded();
    let tickets = Array.from(this.tickets.values());

    if (filters) {
      if (filters.status) {
        tickets = tickets.filter((t) => t.status === filters.status);
      }
      if (filters.category) {
        tickets = tickets.filter((t) => t.category === filters.category);
      }
      if (filters.userId) {
        tickets = tickets.filter((t) => t.userId === filters.userId);
      }
    }

    return tickets.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async listUsers(): Promise<User[]> {
    await this.loadIfNeeded();
    return Array.from(this.users.values());
  }
}

export const dataStore = new DataStore();
export { DataStore };
