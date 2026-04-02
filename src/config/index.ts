import { config as loadDotenv } from 'dotenv';

loadDotenv();

export interface AppConfig {
  deepseek: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  ollama: {
    baseUrl: string;
    embedModel: string;
  };
  rerank: {
    url: string;
  };
  logLevel: LogLevel;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const level = (value ?? 'info').toLowerCase() as LogLevel;
  return validLevels.includes(level) ? level : 'info';
}

export function loadAppConfig(): AppConfig {
  return {
    deepseek: {
      apiKey: getEnv('DEEPSEEK_API_KEY'),
      baseUrl: getEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
      model: getEnv('DEEPSEEK_MODEL', 'deepseek-chat'),
    },
    ollama: {
      baseUrl: getEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
      embedModel: getEnv('OLLAMA_EMBED_MODEL', 'nomic-embed-text'),
    },
    rerank: {
      url: getEnv('RERANK_URL', 'http://localhost:8000/rerank'),
    },
    logLevel: parseLogLevel(process.env['LOG_LEVEL']),
  };
}

export const appConfig = loadAppConfig();
