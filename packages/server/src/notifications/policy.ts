export const GENERIC_PROACTIVE_BODY = "your sidekick sent you a message, tap to read it";

const SENSITIVE_PATTERNS = [
  /\b(?:diagnos|medication|therapy|pregnan|suicid|self[- ]harm)\w*/i,
  /\b(?:bank|debt|salary|rent|mortgage|credit card)\b/i,
  /\b(?:sex|nude|intimate)\w*/i,
  /\b(?:home address|exact location|where you live)\b/i,
];

export function notificationBody(text: string, sequence: number): string {
  if (sequence === 0 || SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return GENERIC_PROACTIVE_BODY;
  }
  return text;
}
