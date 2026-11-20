import {ElevenLabsClient, ElevenLabsError} from "@elevenlabs/elevenlabs-js";
import {defaultAvaVoice} from "../../../lib/ava-voice";

export const maxDuration = 30;

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
    },{timeoutInSeconds:10,maxRetries:1,abortSignal:AbortSignal.any([request.signal, AbortSignal.timeout(23_000)])});
    const clip = await new Response(audio).arrayBuffer();
    if (clip.byteLength === 0) throw new Error("Empty audio");
    return new Response(clip,{headers:{"Content-Type":"audio/mpeg","Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      const details = error.body as {detail?:{status?:unknown}} | undefined;
      const code = details?.detail?.status;
      const providerCode = typeof code === "string" && /^[a-z_]{1,50}$/.test(code) ? code : undefined;
      console.warn("ElevenLabs synthesis failed", {providerStatus: error.statusCode, providerCode});
      return Response.json({
        providerStatus:error.statusCode,
        providerCode,
      },{status:502});
    }
    const reason = error instanceof Error ? error.name : "Unknown";
    console.warn("ElevenLabs audio request did not complete", {reason});
    return Response.json({providerCode:"audio_request_failed"},{status:502});
  }
}
