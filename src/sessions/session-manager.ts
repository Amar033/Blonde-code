import { homedir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: string;
  tokenUsage: number;
  messages: SessionMessage[];
}

export class SessionManager {
  private sessionsDir: string;
  private current: Session | null = null;

  constructor() {
    this.sessionsDir = join(homedir(), '.blonde', 'sessions');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  create(model: string, provider: string): Session {
    this.current = {
      id: randomUUID(),
      name: 'New Session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model,
      provider,
      tokenUsage: 0,
      messages: [],
    };
    return this.current;
  }

  getCurrent(): Session | null {
    return this.current;
  }

  setName(name: string): void {
    if (!this.current) return;
    this.current.name = name;
  }

  addMessage(role: SessionMessage['role'], content: string): void {
    if (!this.current) return;
    this.current.messages.push({ role, content, timestamp: new Date().toISOString() });
    this.current.updatedAt = new Date().toISOString();
  }

  updateTokenUsage(tokens: number): void {
    if (!this.current) return;
    this.current.tokenUsage = tokens;
  }

  async save(): Promise<void> {
    if (!this.current) return;
    const path = join(this.sessionsDir, `${this.current.id}.json`);
    await fs.writeFile(path, JSON.stringify(this.current, null, 2), 'utf-8');
  }

  async loadAll(): Promise<Session[]> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessions = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async f => {
            try {
              const raw = await fs.readFile(join(this.sessionsDir, f), 'utf-8');
              return JSON.parse(raw) as Session;
            } catch {
              return null;
            }
          })
      );
      return (sessions.filter(Boolean) as Session[]).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch {
      return [];
    }
  }
}
