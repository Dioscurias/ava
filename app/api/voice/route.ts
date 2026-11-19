import {ElevenLabsClient, ElevenLabsError} from "@elevenlabs/elevenlabs-js";
import {defaultAvaVoice} from "../../../lib/ava-voice";

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || defaultAvaVoice;
  if (!apiKey) return new Response(null,{status:503});

  let text: unknown;
  try {text = (await request.json())?.text;} catch {return new Response(null,{status:400});}
  if (typeof text !== "string" || !text.trim() || text.length > 600) {
    return new Response(null,{status:400});
  }

  try {
    const client = new ElevenLabsClient({apiKey});
    const audio = await client.textToSpeech.convert(voiceId,{
      text,
      modelId:"eleven_multilingual_v2",
      outputFormat:"mp3_44100_128",
      voiceSettings:{stability:.48,similarityBoost:.76,speed:.96},
    },{timeoutInSeconds:12,maxRetries:0,abortSignal:request.signal});
    return new Response(audio,{headers:{"Content-Type":"audio/mpeg","Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      const details = error.body as {detail?:{status?:unknown}} | undefined;
      const code = details?.detail?.status;
      return Response.json({
        providerStatus:error.statusCode,
        providerCode:typeof code === "string" && /^[a-z_]{1,50}$/.test(code) ? code : undefined,
      },{status:502});
    }
    return new Response(null,{status:502});
  }
}
