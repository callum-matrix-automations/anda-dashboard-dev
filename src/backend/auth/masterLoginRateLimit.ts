const DEFAULT_WINDOW_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_FAILURES = 5;

interface AttemptWindow {
  failures: number;
  startedAt: number;
}

export class MasterLoginRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(
    private readonly windowMs = DEFAULT_WINDOW_MS,
    private readonly maxFailures = DEFAULT_MAX_FAILURES,
  ) {}

  status(key: string, now = Date.now()) {
    const attempt = this.activeAttempt(key, now);
    if (!attempt || attempt.failures < this.maxFailures) {
      return { blocked: false, retryAfterSeconds: 0 } as const;
    }
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((attempt.startedAt + this.windowMs - now) / 1_000)),
    } as const;
  }

  recordFailure(key: string, now = Date.now()) {
    const current = this.activeAttempt(key, now);
    if (current) current.failures += 1;
    else this.attempts.set(key, { failures: 1, startedAt: now });
    return this.status(key, now);
  }

  clear(key: string) {
    this.attempts.delete(key);
  }

  private activeAttempt(key: string, now: number) {
    const attempt = this.attempts.get(key);
    if (!attempt) return null;
    if (attempt.startedAt + this.windowMs <= now) {
      this.attempts.delete(key);
      return null;
    }
    return attempt;
  }
}

export const masterLoginRateLimiter = new MasterLoginRateLimiter();
