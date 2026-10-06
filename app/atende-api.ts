export type ApiConfig = { baseUrl: string; apiKey: string; sessionId: string };

export const operatorStorageKey = "atende-operator-account";

export function errorMessage(data: unknown): string {
  if (!data || typeof data !== "object" || !("message" in data))
    return "Não foi possível concluir esta ação.";
  const message = (data as { message: unknown }).message;
  return Array.isArray(message) ? message.map(String).join(" ") : String(message);
}

function storedOperatorToken(): string {
  try {
    const saved = localStorage.getItem(operatorStorageKey);
    return saved ? String(JSON.parse(saved)?.token || "") : "";
  } catch {
    return "";
  }
}

export function apiRequest(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/$/, "")}/api${path}`, init);
}

export function request(config: ApiConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("X-API-Key")) headers.set("X-API-Key", config.apiKey);
  if (!headers.has("X-Atende-Token")) headers.set("X-Atende-Token", storedOperatorToken());
  return apiRequest(config.baseUrl, path, { ...init, headers });
}

export function operatorRequest(baseUrl: string, token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("X-Atende-Token", token);
  return apiRequest(baseUrl, `/operator-auth${path}`, { ...init, headers });
}

export async function operatorJson<T>(baseUrl: string, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await operatorRequest(baseUrl, token, path, init);
  if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
  return response.json() as Promise<T>;
}
