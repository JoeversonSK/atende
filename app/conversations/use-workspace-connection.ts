"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { errorMessage, operatorRequest, type ApiConfig } from "../atende-api";
import { createSessionRecord, resolveSessionId, restoreSessionIfNeeded, startSessionAndReadQr } from "./session-connection";
import { persistConfig } from "./workspace-storage";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Options = {
  config: ApiConfig;
  operatorToken: string;
  setConfig: Setter<ApiConfig>;
  setStatus: Setter<"unconfigured" | "offline" | "ready" | "connected">;
  setNotice: Setter<string>;
  setBusy: Setter<boolean>;
  refreshChats: (active?: ApiConfig) => Promise<void>;
};

export function useWorkspaceConnection({ config, operatorToken, setConfig, setStatus, setNotice, setBusy, refreshChats }: Options) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorToken || (config.apiKey && !config.apiKey.startsWith("atende_"))) return;
    const credential = `atende_${operatorToken}`;
    if (config.apiKey === credential && config.sessionId) return;
    const controller = new AbortController();
    void operatorRequest(config.baseUrl, operatorToken, "/connection", { signal: controller.signal })
      .then(async response => {
        const result = await response.json() as { sessionId?: string };
        if (!response.ok) throw new Error(errorMessage(result));
        if (!controller.signal.aborted) {
          setConfig(current => ({ ...current, apiKey: credential, sessionId: result.sessionId || current.sessionId }));
          setNotice("Carregando as conversas da equipe…");
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Não foi possível carregar a conexão da equipe.");
      });
    return () => controller.abort();
  }, [operatorToken, config.baseUrl, config.apiKey, config.sessionId, setConfig, setNotice]);

  async function connect(active = config) {
    if (!active.apiKey) { setNotice("Informe a chave da API do OpenWA."); return; }
    setBusy(true);
    try {
      const sessionId = await resolveSessionId(active);
      const next = { ...active, sessionId };
      setConfig(next);
      persistConfig(next);
      if (sessionId) await restoreSessionIfNeeded(next, () => setNotice("Restaurando a sessão existente do WhatsApp…"));
      setStatus(sessionId ? "ready" : "offline");
      setNotice(sessionId ? "Conectado. Carregando suas conversas." : "Crie uma sessão para conectar o WhatsApp.");
      if (sessionId) await refreshChats(next);
      setNotice("Conexão salva com sucesso.");
    } catch (error) {
      setStatus("offline");
      setNotice(error instanceof TypeError ? "Não foi possível acessar o OpenWA local."
        : error instanceof Error ? error.message : "Falha de conexão.");
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    setBusy(true);
    try {
      const next = await createSessionRecord(config);
      setConfig(next);
      persistConfig(next);
      setQr(await startSessionAndReadQr(next));
      setStatus("ready");
      setNotice("Sessão criada. Leia o QR Code no WhatsApp da empresa.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível criar a sessão.");
    } finally {
      setBusy(false);
    }
  }

  return { qr, setQr, connect, createSession };
}
