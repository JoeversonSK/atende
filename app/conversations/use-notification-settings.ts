import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { operatorJson } from "../atende-api";
import {
  defaultNotificationPreferences,
  loadNotificationPreferences,
  notificationStorageKey,
  type NotificationPreferences,
} from "./workspace-storage";

type CustomNotificationSound = { filename: string; mimetype: string; base64: string };

export function useNotificationSettings({
  operatorId,
  operatorToken,
  baseUrl,
  setNotice,
}: {
  operatorId?: string;
  operatorToken: string;
  baseUrl: string;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const notificationsRef = useRef(false);
  const notificationPreferencesRef = useRef<NotificationPreferences>(defaultNotificationPreferences);
  const audioContextRef = useRef<AudioContext | null>(null);
  const customSoundRef = useRef<CustomNotificationSound | null>(null);
  const activeCustomAudioRef = useRef<HTMLAudioElement | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(defaultNotificationPreferences);
  const [customSound, setCustomSound] = useState<CustomNotificationSound | null>(null);
  const [customSoundBusy, setCustomSoundBusy] = useState(false);

  const playNotificationSound = useCallback(() => {
    try {
      const context = audioContextRef.current;
      const preferences = notificationPreferencesRef.current;
      if (!preferences.sound || preferences.volume <= 0) return;
      if (preferences.soundType === "custom" && customSoundRef.current) {
        activeCustomAudioRef.current?.pause();
        const sound = customSoundRef.current;
        const audio = new Audio(`data:${sound.mimetype};base64,${sound.base64}`);
        audio.volume = preferences.volume / 100;
        activeCustomAudioRef.current = audio;
        audio.onended = () => { if (activeCustomAudioRef.current === audio) activeCustomAudioRef.current = null; };
        void audio.play().catch(() => undefined);
        return;
      }
      if (!context) return;
      const patterns = {
        classic: [[880, 0, 0.14]],
        soft: [[660, 0, 0.12], [784, 0.14, 0.13]],
        bell: [[1046, 0, 0.16], [1318, 0.18, 0.2]],
        urgent: [[880, 0, 0.12], [880, 0.18, 0.12], [1175, 0.36, 0.24]],
      } as Record<Exclude<NotificationPreferences["soundType"], "custom">, number[][]>;
      for (const [frequency, offset, duration] of patterns[
        preferences.soundType === "custom" ? "classic" : preferences.soundType
      ]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + offset;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(Math.max(0.001, (preferences.volume / 100) * 0.12), start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration);
      }
    } catch {
      /* O navegador pode bloquear áudio sem interação do usuário. */
    }
  }, []);

  const updateNotificationPreferences = useCallback((patch: Partial<NotificationPreferences>) => {
    const next = { ...notificationPreferencesRef.current, ...patch };
    notificationPreferencesRef.current = next;
    notificationsRef.current = next.enabled;
    setNotificationPreferences(next);
    setNotificationsEnabled(next.enabled);
    if (operatorId) localStorage.setItem(`${notificationStorageKey}:${operatorId}`, JSON.stringify(next));
  }, [operatorId]);

  async function uploadNotificationSound(file: File) {
    if (!operatorToken || customSoundBusy) return;
    if (!file.size || file.size > 2 * 1024 * 1024) { setNotice("Escolha um áudio de até 2 MB."); return; }
    setCustomSoundBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      const result = await operatorJson<CustomNotificationSound>(baseUrl, operatorToken, "/me/notification-sound", {
        method: "PUT", body: JSON.stringify({ filename: file.name, mimetype: file.type, base64 }),
      });
      customSoundRef.current = result;
      setCustomSound(result);
      updateNotificationPreferences({ sound: true, soundType: "custom" });
      setNotice("Áudio personalizado salvo para sua conta.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar o áudio."); }
    finally { setCustomSoundBusy(false); }
  }

  async function removeNotificationSound() {
    if (!operatorToken || customSoundBusy) return;
    setCustomSoundBusy(true);
    try {
      await operatorJson<{ success: boolean }>(baseUrl, operatorToken, "/me/notification-sound", { method: "DELETE" });
      activeCustomAudioRef.current?.pause();
      customSoundRef.current = null;
      setCustomSound(null);
      if (notificationPreferencesRef.current.soundType === "custom") updateNotificationPreferences({ soundType: "classic" });
      setNotice("Áudio personalizado removido da sua conta.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível remover o áudio."); }
    finally { setCustomSoundBusy(false); }
  }

  async function enableNotifications() {
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume();
      updateNotificationPreferences({ enabled: true });
      let permission: NotificationPermission = "default";
      if (window.isSecureContext && "Notification" in window)
        permission = Notification.permission === "default"
          ? await Notification.requestPermission() : Notification.permission;
      playNotificationSound();
      setNotice(permission === "granted"
        ? "Som e notificações ativados neste computador."
        : "Som e avisos no canto da tela ativados. Mantenha o sistema aberto. Notificações fora da página exigem HTTPS e permissão do navegador.");
    } catch {
      setNotice("Não foi possível ativar o som. Clique novamente em Notificações.");
    }
  }

  async function testNotification() {
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume();
      playNotificationSound();
      if (window.isSecureContext && notificationPreferencesRef.current.desktop && "Notification" in window) {
        const permission = Notification.permission === "default"
          ? await Notification.requestPermission() : Notification.permission;
        if (permission === "granted")
          new Notification("Teste de notificação", {
            body: "Cada nova mensagem terá um aviso separado.",
            tag: `atende-test-${Date.now()}`,
          });
      }
      setNotice("Teste de notificação executado.");
    } catch {
      setNotice("O navegador bloqueou o teste. Revise a permissão de notificações.");
    }
  }

  useEffect(() => {
    const abort = new AbortController();
    if (!operatorId || !operatorToken) {
      activeCustomAudioRef.current?.pause();
      customSoundRef.current = null;
      queueMicrotask(() => { if (!abort.signal.aborted) setCustomSound(null); });
      return () => abort.abort();
    }
    activeCustomAudioRef.current?.pause();
    customSoundRef.current = null;
    const saved = loadNotificationPreferences(operatorId);
    notificationPreferencesRef.current = saved;
    notificationsRef.current = saved.enabled;
    queueMicrotask(() => {
      if (abort.signal.aborted) return;
      setCustomSound(null);
      setNotificationPreferences(saved);
      setNotificationsEnabled(saved.enabled);
    });
    operatorJson<CustomNotificationSound | null>(baseUrl, operatorToken, "/me/notification-sound", { signal: abort.signal })
      .then(sound => {
        customSoundRef.current = sound;
        setCustomSound(sound);
        if (!sound && saved.soundType === "custom") updateNotificationPreferences({ soundType: "classic" });
        if (sound && !localStorage.getItem(`${notificationStorageKey}:${operatorId}`)) updateNotificationPreferences({ soundType: "custom" });
      })
      .catch(() => { if (!abort.signal.aborted) setNotice("Não foi possível carregar o áudio personalizado."); });
    return () => abort.abort();
  }, [operatorId, operatorToken, baseUrl, updateNotificationPreferences, setNotice]);

  return {
    notificationsRef,
    notificationPreferencesRef,
    notificationsEnabled,
    notificationPreferences,
    customSound,
    customSoundBusy,
    playNotificationSound,
    updateNotificationPreferences,
    uploadNotificationSound,
    removeNotificationSound,
    enableNotifications,
    testNotification,
  };
}
