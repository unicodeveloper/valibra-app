type ProviderError = Error & {
  status?: number;
  code?: string;
  type?: string;
  error?: { code?: string; type?: string; message?: string };
};

const OPENAI_KEY_RE = /sk-[A-Za-z0-9_-]+/g;

export function redactSecrets(value: unknown): string {
  return String(value ?? "").replace(OPENAI_KEY_RE, "[redacted-openai-key]");
}

export function logServerError(context: string, err: unknown) {
  const message = err instanceof Error ? err.message : err;
  console.error(`${context}:`, redactSecrets(message));
}

export function publicErrorMessage(err: unknown, fallback: string): string {
  const e = err as ProviderError;
  const message = err instanceof Error ? err.message : "";
  const code = e?.code ?? e?.error?.code;
  const type = e?.type ?? e?.error?.type;

  if (message === "OPENAI_API_KEY is not set") {
    return "OpenAI is not configured on the server. Set OPENAI_API_KEY and restart the app.";
  }

  if (
    e?.status === 401 ||
    code === "invalid_api_key" ||
    type === "invalid_request_error" && /api key/i.test(message)
  ) {
    return "OpenAI rejected the server API key. Update OPENAI_API_KEY in the runtime environment and restart the app.";
  }

  return fallback;
}
