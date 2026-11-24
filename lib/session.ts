import { headers } from 'next/headers';
import { auth } from './auth';

/** Signed-in user for this request, or null. Call from route handlers / server components. */
export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });
