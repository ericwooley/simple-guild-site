import type { APIRoute } from 'astro';
import { confirmDesktopLogin } from '../../server/battlenet.mjs';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    return await confirmDesktopLogin(request);
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    const message = typeof error?.message === 'string' ? error.message : 'Desktop sign-in confirmation failed.';
    return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
};
