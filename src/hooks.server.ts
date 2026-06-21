import type { Handle } from '@sveltejs/kit';
import { crossOriginIsolationHeaders } from '$lib/server/crossOriginIsolation';

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  for (const [name, value] of Object.entries(crossOriginIsolationHeaders(process.env)))
    response.headers.set(name, value);

  return response;
};
