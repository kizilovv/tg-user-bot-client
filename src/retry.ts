export interface Logger {
  warn: (message: string, context?: Record<string, unknown>) => void;
}

export const consoleLogger: Logger = {
  warn: (message, context) => console.warn(`[tg-user-bot] ${message}`, context ?? ''),
};

export interface BackoffOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  logger?: Logger;
}

/**
 * Exponential backoff with jitter. Retries on any thrown error up to
 * `maxRetries` times, doubling the delay each attempt and adding a random
 * jitter so concurrent callers don't wake up in sync.
 */
export async function withBackoff<T>(fn: () => Promise<T>, options: BackoffOptions = {}): Promise<T> {
  const { maxRetries = 5, initialDelayMs = 1000, maxDelayMs = 30_000, logger = consoleLogger } = options;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries) {
        logger.warn(`All ${maxRetries} retry attempts failed`, { error: (err as Error).message });
        throw err;
      }
      const exp = initialDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * initialDelayMs;
      const delay = Math.min(exp + jitter, maxDelayMs);
      logger.warn(`API call failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(delay)}ms`, {
        error: (err as Error).message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
