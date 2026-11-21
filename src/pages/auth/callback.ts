import type { APIRoute } from 'astro';
import { finishBattleNet } from '../../server/battlenet.mjs';
import { errorResponse } from '../../server/service.mjs';
export const prerender = false;
export const GET: APIRoute = async ({request}) => {
  try { return await finishBattleNet(request); }
  catch (error) { return errorResponse(error); }
};
