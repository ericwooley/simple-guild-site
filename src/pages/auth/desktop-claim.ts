import type { APIRoute } from 'astro';
import { claimDesktopLogin } from '../../server/battlenet.mjs';
import { errorResponse } from '../../server/service.mjs';
export const prerender = false;
export const POST: APIRoute = async ({ request }) => {
  try { return await claimDesktopLogin(request); }
  catch (error) { return errorResponse(error); }
};
