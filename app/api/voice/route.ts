const defaultVoice = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

export const maxDuration = 20;

export async function POST(request: Request) {
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  if (!apiKey) return new Response(null, {status: 503});

  let text: unknown;
  try {
    text = (await request.json())?.text;
  } catch {
    return new Response(null, {status: 400});
  }
  if (typeof text !== "string" || !text.trim() || text.length > 600) {
    return new Response(null, {status: 400});
  }

  try {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": "2026-08-14",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-3.6",
        transcript: text.trim().replace(/\bUSDC\b/g, "U S D C"),
        voice: process.env.CARTESIA_VOICE_ID?.trim() || defaultVoice,
        language: "en",
        normalization: "auto",
        generation_config: {speed: 0.95},
        output_format: {container: "wav", encoding: "pcm_s16le", sample_rate: 44100},
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]),
    });
    if (!response.ok) {
      console.warn("Cartesia synthesis failed", {providerStatus: response.status});
      return Response.json({providerStatus: response.status}, {status: 502});
    }

    const audio = await response.arrayBuffer();
    const header = new TextDecoder().decode(audio.slice(0, 12));
    if (audio.byteLength <= 44 || !header.startsWith("RIFF") || !header.endsWith("WAVE")) {
      throw new Error("Invalid WAV response");
    }
    return new Response(audio, {headers: {"Content-Type": "audio/wav", "Cache-Control": "no-store"}});
  } catch (error) {
    console.warn("Cartesia audio request did not complete", {reason: error instanceof Error ? error.name : "Unknown"});
    return new Response(null, {status: 502});
  }
}
