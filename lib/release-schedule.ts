const duration = /^(?:in\s+)?(\d+)\s+(seconds?|minutes?|hours?|days?)$/i;
const durationSuffix = /\s+(in\s+\d+\s+(?:seconds?|minutes?|hours?|days?))$/i;
const timestamp = /^(?:at\s+)?(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/i;
const timestampSuffix = /\s+(at\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))$/i;
const milli = {second:1000, minute:60_000, hour:3_600_000, day:86_400_000};
const priorCondition = /\b(?:when|once|after|until|if)\s/i;

export function splitScheduledPayment(input: string) {
  const suffix = input.match(durationSuffix) ?? input.match(timestampSuffix);
  if (!suffix || suffix.index === undefined) return null;
  const payment = input.slice(0,suffix.index).trim();
  // A time mentioned within a separate delivery condition is not standalone authorization.
  return priorCondition.test(payment) ? null : {payment, condition:suffix[1]};
}

export function scheduledCondition(condition: string) {
  const text = condition.trim();
  const relative = text.match(duration);
  if (relative) {
    const unit = relative[2].toLowerCase().replace(/s$/, "") as keyof typeof milli;
    return {kind:"delay" as const, afterMs:Number(relative[1]) * milli[unit], text:`${relative[1]} ${relative[2].toLowerCase()} after funding`};
  }
  const date = text.match(timestamp);
  if (!date) return null;
  const midnight = new Date(date[1] + "T00:00:00Z");
  const validDay = Number.isFinite(midnight.getTime()) && midnight.toISOString().slice(0,10) === date[1];
  const at = validDay ? Date.parse(text.replace(/^at\s+/i,"")) : NaN;
  return {kind:"date" as const, at, text:Number.isFinite(at) ? formatReleaseDate(at) : "Invalid date or time zone"};
}

export function releaseTime(condition: string, now: number) {
  const schedule = scheduledCondition(condition);
  if (!schedule) return undefined;
  const at = schedule.kind === "date" ? schedule.at : now + schedule.afterMs;
  return Number.isFinite(at) && at <= 8_640_000_000_000_000 && at > now ? at : null;
}

export function formatReleaseDate(at: number) {
  return new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"long",timeZone:"UTC"}).format(at);
}
