export type ReconciledMessage = {
  id: string;
  identityIds: string[];
  timestamp: number;
  time: string;
  source: "database" | "history" | "optimistic" | "both";
  historyTimestamp?: number;
  historyOrder?: number;
  media?: { data?: string };
};

export function messageTimestamp(value: unknown): number {
  const number = typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) ? Number(value) : NaN;
  const result = Number.isFinite(number)
    ? number * (number < 10_000_000_000 ? 1000 : 1)
    : typeof value === "string" ? Date.parse(value) : 0;
  return Number.isFinite(result) ? result : 0;
}

// A confirmation can bridge two previously separate copies (local ID and WhatsApp ID).
// Collapse every matching component, not just the first matching ID.
export function reconcileMessages<T extends ReconciledMessage>(messages: T[]): T[] {
  const rows = new Map<number, T>();
  const identities = new Map<string, number>();
  let sequence = 0;
  for (const message of messages) {
    const matches = [...new Set(message.identityIds.map(id => identities.get(id)).filter((id): id is number => id !== undefined))];
    let combined = message;
    for (const index of matches) {
      const previous = rows.get(index)!;
      const history = combined.historyTimestamp !== undefined ? combined : previous.historyTimestamp !== undefined ? previous : undefined;
      const preferred = combined.source === "optimistic" ? previous : combined;
      combined = {
        ...previous, ...preferred,
        identityIds: [...new Set([...previous.identityIds, ...combined.identityIds])],
        source: previous.source === combined.source ? combined.source : "both",
        ...(history ? { timestamp: history.historyTimestamp!, time: history.time, historyTimestamp: history.historyTimestamp, historyOrder: combined.historyOrder ?? previous.historyOrder } : {}),
        media: combined.media?.data ? combined.media : previous.media?.data ? previous.media : combined.media || previous.media,
      };
      rows.delete(index);
    }
    const index = matches[0] ?? sequence++;
    rows.set(index, combined);
    for (const id of combined.identityIds) identities.set(id, index);
  }
  return [...rows.values()].sort((a, b) => a.timestamp - b.timestamp ||
    (a.historyOrder !== undefined && b.historyOrder !== undefined ? a.historyOrder - b.historyOrder : a.id.localeCompare(b.id)));
}
