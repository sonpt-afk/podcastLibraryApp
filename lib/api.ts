import { ServiceError } from './ebooks';
import { getUser, unauthorized } from './session';

type User = NonNullable<Awaited<ReturnType<typeof getUser>>>;

/** Route wrapper: 401 when signed out, ServiceError -> its status, anything else -> 500 (logged, message hidden). */
export function authed<A extends unknown[]>(fn: (user: User, ...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const user = await getUser();
    if (!user) return unauthorized();
    try {
      return await fn(user, ...args);
    } catch (e) {
      if (e instanceof ServiceError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: 'internal error' }, { status: 500 });
    }
  };
}

export const tooMany = () => Response.json({ error: 'Too many requests, try again later.' }, { status: 429 });

export type Ctx = { params: Promise<{ id: string }> };
