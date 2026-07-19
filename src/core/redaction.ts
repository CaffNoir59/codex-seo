const secretPatterns: RegExp[] = [
  /Authorization:\s*Bearer\s+[^\s,;]+/gi,
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/g,
  /([?&](?:api_key|key|token|access_token|refresh_token|client_secret|secret)=)[^&#\s]+/gi,
  /("(?:private_key|client_secret|refresh_token|access_token|api_key)"\s*:\s*")[^"]+(")/gi,
  /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
  /\b(?:ghp|github_pat|sk|sbp)_[A-Za-z0-9_-]{16,}\b/g,
  /\/\/([^\s/@:]+):([^\s/@]+)@/g
];

export function redactSecrets(value: unknown, options: { privacyMode?: boolean } = {}): string {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, (match, a, b) => {
      if (match.includes("//") && a && b) return `//[redacted]:[redacted]@`;
      if (a && b) return `${a}[redacted]${b}`;
      if (a) return `${a}[redacted]`;
      return "[redacted]";
    });
  }
  if (options.privacyMode) text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
  return text;
}

export function redactObject<T>(value: T, options: { privacyMode?: boolean } = {}): T {
  if (typeof value === "string") return redactSecrets(value, options) as T;
  if (Array.isArray(value)) return value.map((item) => redactObject(item, options)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => /password|passwd|privateKey|clientSecret|accessToken|refreshToken|apiKey|secret|token|credential/i.test(key) ? [key, "[redacted]"] : [key, redactObject(item, options)])) as T;
  }
  return value;
}