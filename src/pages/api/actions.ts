import type { APIRoute } from 'astro';
import { handleAction, jsonResponse, errorResponse } from '../../server/service.mjs';
export const prerender = false;
export const POST: APIRoute = async ({request, clientAddress}) => {
  try {
    const {cookie,...value} = await handleAction(request,clientAddress);
    return jsonResponse(value,200,cookie ? {'set-cookie':cookie} : {});
  } catch (error) { return errorResponse(error, request); }
};
