"use client";

import { useEffect, useRef } from "react";
import { operatorJson, operatorRequest } from "./atende-api";

export type TeamAlertFeed = {
  cursorAt: string;
  cursorId: string;
  unreadCount: number;
  alerts: {
    id: string;
    recipientId: string | null;
    senderName: string;
    body: string;
    mentioned: boolean;
  }[];
};

export type PollingTask = {
  id: string;
  intervalMs: number;
  immediate?: boolean;
  run: () => void | Promise<void>;
};

/** Um único temporizador agenda as consultas, sem sobrepor execuções da mesma tarefa. */
export function startPollingSchedule(tasks: PollingTask[]) {
  const next = new Map(tasks.map(task => [task.id, Date.now() + (task.immediate ? 0 : task.intervalMs)]));
  const running = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    if (stopped || !tasks.length) return;
    const dueAt = Math.min(...tasks.map(task => next.get(task.id)!));
    timer = setTimeout(tick, Math.max(10, dueAt - Date.now()));
  }

  function tick() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    const now = Date.now();
    for (const task of tasks) {
      if (next.get(task.id)! > now) continue;
      next.set(task.id, now + task.intervalMs);
      if (running.has(task.id)) continue;
      running.add(task.id);
      void Promise.resolve().then(task.run).catch(() => undefined).finally(() => running.delete(task.id));
    }
    schedule();
  }

  tick();
  return {
    trigger(id: string) {
      if (stopped || !next.has(id) || running.has(id)) return;
      next.set(id, Date.now());
      tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

type WorkspacePollingOptions = {
  baseUrl: string;
  token: string;
  apiKey: string;
  sessionId: string;
  onTeamReset: () => void;
  onTeamFeed: (feed: TeamAlertFeed) => void;
  onOperator: (user: unknown) => void;
  onSessionExpired: () => void;
  onReconcile: () => void;
};

/** A atualização de equipe, acesso e conversas compartilha um único ciclo de agendamento. */
export function useWorkspacePolling(options: WorkspacePollingOptions) {
  const callbacks = useRef(options);
  const { baseUrl, token, apiKey, sessionId } = options;
  useEffect(() => { callbacks.current = options; });

  useEffect(() => {
    callbacks.current.onTeamReset();
    if (!token) return;
    const abort = new AbortController();
    let cursorAt = "";
    let cursorId = "";
    const tasks: PollingTask[] = [
      {
        id: "team",
        intervalMs: 4000,
        immediate: true,
        async run() {
          const query = cursorAt ? `?afterAt=${encodeURIComponent(cursorAt)}&afterId=${encodeURIComponent(cursorId)}` : "";
          try {
            const feed = await operatorJson<TeamAlertFeed>(baseUrl, token, `/team-chat/alerts${query}`, { signal: abort.signal });
            if (abort.signal.aborted) return;
            cursorAt = feed.cursorAt;
            cursorId = feed.cursorId;
            callbacks.current.onTeamFeed(feed);
          } catch { /* A próxima atualização tenta novamente quando a rede voltar. */ }
        },
      },
      {
        id: "access",
        intervalMs: 15000,
        async run() {
          try {
            const response = await operatorRequest(baseUrl, token, "/me", { signal: abort.signal });
            if (abort.signal.aborted) return;
            if (response.status === 401) callbacks.current.onSessionExpired();
            else if (response.ok) {
              const user: unknown = await response.json();
              if (!abort.signal.aborted) callbacks.current.onOperator(user);
            }
          } catch { /* Uma falha de rede não apaga a sessão salva. */ }
        },
      },
    ];
    if (apiKey && sessionId) tasks.push({
      id: "reconcile",
      intervalMs: 15000,
      run() {
        if (document.visibilityState === "visible") callbacks.current.onReconcile();
      },
    });
    const schedule = startPollingSchedule(tasks);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule.trigger("reconcile");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      abort.abort();
      schedule.stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [baseUrl, token, apiKey, sessionId]);
}
