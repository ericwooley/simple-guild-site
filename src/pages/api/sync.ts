import type { APIRoute } from 'astro';
import { handleSync, jsonResponse, errorResponse } from '../../server/service.mjs';
export const prerender = false;
export const POST: APIRoute = async ({request, clientAddress}) => {
  try { return jsonResponse(await handleSync(request,clientAddress)); }
  catch (error) { return errorResponse(error, request); }
};
