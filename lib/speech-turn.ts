export type RecognitionResult = ArrayLike<{transcript: string}> & {isFinal: boolean};

export const speechSilenceMs = 1700;

export function readSpeechTurn(results: ArrayLike<RecognitionResult>) {
  const segments = Array.from(results);
  const preview = segments.map(result => result[0]?.transcript ?? "").join(" ").trim()
    .replace(/\bu[.\s]+s[.\s]+d[.\s]+c\b\.?/gi, "USDC");
  return {preview, complete: segments.every(segment => segment.isFinal) ? preview : ""};
}
