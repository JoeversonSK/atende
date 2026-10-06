import { operatorStorageKey, type ApiConfig } from "../atende-api";
import { connectionOrigin } from "../connection-origin";
import type { OperatorIdentity } from "../operator-activity";

const storageKey = "atende-openwa-config";
export const notificationStorageKey = "atende-notification-preferences";

export type NotificationPreferences = {
  enabled: boolean;
  desktop: boolean;
  sound: boolean;
  notifyMessages: boolean;
  notifyAssignments: boolean;
  showPreview: boolean;
  soundType: "classic" | "soft" | "bell" | "urgent" | "custom";
  volume: number;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: false,
  desktop: true,
  sound: true,
  notifyMessages: true,
  notifyAssignments: true,
  showPreview: true,
  soundType: "classic",
  volume: 70,
};

export const emptyConfig: ApiConfig = {
  baseUrl: "http://127.0.0.1:2785",
  apiKey: "",
  sessionId: "",
};

export function loadConfig(): ApiConfig {
  try {
    const saved = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey) || "{}";
    const config = { ...emptyConfig, ...JSON.parse(saved) };
    return { ...config, baseUrl: connectionOrigin(config.baseUrl, window.location.origin) };
  } catch {
    return { ...emptyConfig, baseUrl: window.location.origin };
  }
}

export function persistConfig(config: ApiConfig) {
  const saved = JSON.stringify(config);
  localStorage.setItem(storageKey, saved);
  sessionStorage.setItem(storageKey, saved);
}

export function loadOperator(): { user: OperatorIdentity; token: string } | null {
  try {
    return JSON.parse(localStorage.getItem(operatorStorageKey) || "null");
  } catch {
    return null;
  }
}

export function persistOperator(value: { user: OperatorIdentity; token: string } | null) {
  if (value) localStorage.setItem(operatorStorageKey, JSON.stringify(value));
  else localStorage.removeItem(operatorStorageKey);
}

export function loadNotificationPreferences(userId: string): NotificationPreferences {
  try {
    const key = `${notificationStorageKey}:${userId}`;
    let saved = localStorage.getItem(key);
    if (!saved && loadOperator()?.user.id === userId) {
      saved = localStorage.getItem(notificationStorageKey);
      if (saved) {
        localStorage.setItem(key, saved);
        localStorage.removeItem(notificationStorageKey);
      }
    }
    return { ...defaultNotificationPreferences, ...JSON.parse(saved || "{}") };
  } catch {
    return defaultNotificationPreferences;
  }
}
