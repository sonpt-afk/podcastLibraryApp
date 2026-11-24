/** JSON fetch helper: throws Error(server `error` message) on non-2xx. */
export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Request failed (${r.status})`);
  return j as T;
}
