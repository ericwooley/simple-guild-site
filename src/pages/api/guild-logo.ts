import type { APIRoute } from 'astro';
import { jsonResponse } from '../../server/service.mjs';
export const prerender = false;
export const POST: APIRoute = async () => jsonResponse({ ok: false, message: 'Custom guild logo uploads are disabled.' }, 403);
