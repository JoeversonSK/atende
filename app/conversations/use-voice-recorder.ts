import { useRef, useState, type Dispatch, type SetStateAction } from "react";

export function useVoiceRecorder({
  onVoice,
  setNotice,
}: {
  onVoice: (file: File) => void;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      discardRecordingRef.current = false;
      recorder.ondataavailable = event => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
        setRecordingPaused(false);
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (!discardRecordingRef.current && blob.size)
          onVoice(new File([blob], "mensagem-de-voz.webm", { type: blob.type }));
      };
      recorder.start();
      setRecording(true);
      setNotice("Gravando áudio.");
    } catch {
      setNotice("Permita o uso do microfone para gravar um áudio.");
    }
  }

  function pauseOrResumeRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setRecordingPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setRecordingPaused(false);
    }
  }

  function sendRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive")
      recorderRef.current.stop();
  }

  function discardRecording() {
    discardRecordingRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive")
      recorderRef.current.stop();
    else {
      setRecording(false);
      setRecordingPaused(false);
    }
  }

  return { recording, recordingPaused, startRecording,
    pauseOrResumeRecording, sendRecording, discardRecording };
}
