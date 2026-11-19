export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return new Response(null, {status:503});

  let text: unknown;
  try {text = (await request.json())?.text;} catch {return new Response(null,{status:400});}
  if (typeof text !== "string" || !text.trim() || text.length > 600) {
    return new Response(null,{status:400});
  }
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method:"POST",
        headers:{"xi-api-key":apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({text,model_id:"eleven_flash_v2_5"}),
        signal:AbortSignal.any([request.signal,AbortSignal.timeout(8_000)]),
      },
    );
    if (!upstream.ok || !upstream.body) return new Response(null,{status:502});
    return new Response(upstream.body,{headers:{"Content-Type":"audio/mpeg","Cache-Control":"no-store"}});
  } catch {
    return new Response(null,{status:502});
  }
}
