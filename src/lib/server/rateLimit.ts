export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const WINDOW_MS = Number(process.env.KRIOL_COMPILE_RATE_LIMIT_WINDOW_MS ?? 60_000);
const MAX_REQUESTS = Number(process.env.KRIOL_COMPILE_RATE_LIMIT_MAX ?? 12);
const CLEANUP_INTERVAL_MS = Math.max(WINDOW_MS, 60_000);

interface Bucket {
  count: number;
  resetAt: number;
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();
let lastCleanup = 0;

export function checkCompileRateLimit(key: string, now = Date.now()): RateLimitResult {
  cleanupExpiredBuckets(now);

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + WINDOW_MS,
      lastSeen: now
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.lastSeen = now;
  if (bucket.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function cleanupExpiredBuckets(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS)
    return;

  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastSeen > WINDOW_MS * 2)
      buckets.delete(key);
  }
}
