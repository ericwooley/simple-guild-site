import type { APIRoute } from 'astro';
import { beginBattleNet } from '../../server/battlenet.mjs';
import { errorResponse } from '../../server/service.mjs';
export const prerender = false;
export const GET: APIRoute = async ({request}) => {
  try { return await beginBattleNet(request); }
  catch (error) { return errorResponse(error); }
};
