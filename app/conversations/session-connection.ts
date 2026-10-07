import { apiRequest, errorMessage, request, type ApiConfig } from "../atende-api";
import { listFrom } from "../conversation-model";

export async function resolveSessionId(config: ApiConfig): Promise<string> {
  const health = await apiRequest(config.baseUrl, "/health");
  if (!health.ok) throw new Error("O OpenWA respondeu com erro.");
  if (config.sessionId) return config.sessionId;
  const response = await request(config, "/sessions?limit=100");
  const first = listFrom(await response.json())[0];
  return first ? String(first.id || first.sessionId) : "";
}

export async function restoreSessionIfNeeded(
  config: ApiConfig,
  onRestore: () => void,
): Promise<void> {
  if (!config.sessionId) return;
  const sessionPath = `/sessions/${encodeURIComponent(config.sessionId)}`;
  const response = await request(config, sessionPath);
  if (!response.ok)
    throw new Error(errorMessage(await response.json().catch(() => null)));
  const session = await response.json() as { status?: string };
  if (!["failed", "disconnected", "created"].includes(String(session.status).toLowerCase())) return;
  onRestore();
  const restored = await request(config, `${sessionPath}/start`, { method: "POST" });
  if (!restored.ok)
    throw new Error(errorMessage(await restored.json().catch(() => null)));
}

export async function createSessionRecord(config: ApiConfig, now = Date.now()): Promise<ApiConfig> {
  const response = await request(config, "/sessions", {
    method: "POST",
    body: JSON.stringify({ name: `atende-${now}` }),
  });
  if (!response.ok)
    throw new Error(errorMessage(await response.json().catch(() => null)));
  const data = await response.json() as { id?: string; sessionId?: string };
  return { ...config, sessionId: String(data.id || data.sessionId) };
}

export async function startSessionAndReadQr(config: ApiConfig): Promise<string> {
  const sessionPath = `/sessions/${encodeURIComponent(config.sessionId)}`;
  await request(config, `${sessionPath}/start`, { method: "POST" });
  const response = await request(config, `${sessionPath}/qr`);
  const data = await response.json() as { qrCode?: string; data?: string } | string;
  return typeof data === "string" ? data : String(data.qrCode || data.data || data);
}
