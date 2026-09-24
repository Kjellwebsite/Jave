import pino from 'pino';

export type Logger = pino.Logger;

export interface LoggerOptions {
  name: string;
  level?: string;
  pretty?: boolean;
}

/**
 * Structured JSON logs. Secret-bearing fields are redacted at the logger level
 * as a second line of defense (the first is never logging them).
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    name: options.name,
    level: options.level ?? 'info',
    base: { service: options.name },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        '*.token',
        '*.secret',
        '*.password',
        '*.authorization',
        '*.cookie',
        '*.apiKey',
        'headers.authorization',
        'headers.cookie',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export const silentLogger: Logger = pino({ level: 'silent' });
