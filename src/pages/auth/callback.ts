import type { APIRoute } from 'astro';
import { finishBattleNet } from '../../server/battlenet.mjs';
import { errorResponse } from '../../server/service.mjs';
export const prerender = false;
export const GET: APIRoute = async ({request, clientAddress}) => {
  try { return await finishBattleNet(request, fetch, clientAddress); }
  catch (error) { return errorResponse(error); }
};
