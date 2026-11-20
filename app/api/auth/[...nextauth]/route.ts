import {googleAuthEnabled, handlers} from "../../../../auth";

export const GET: typeof handlers.GET = async request => googleAuthEnabled
  ? handlers.GET(request) : Response.json({error:"Google sign-in is unavailable."}, {status:503});

export const POST: typeof handlers.POST = async request => googleAuthEnabled
  ? handlers.POST(request) : Response.json({error:"Google sign-in is unavailable."}, {status:503});
