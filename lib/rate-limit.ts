// ponytail: in-memory sliding window, per process. Fine for one container (ADR-0002); use Redis/Postgres if we ever scale out.
const hits = new Map<string, number[]>();

/** true = allowed (and counted), false = over the limit. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
