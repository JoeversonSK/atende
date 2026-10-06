"use client";

import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";

export function PasteFilePreview({ file, index }: { file: File; index: number }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file";
  useEffect(() => {
    if (kind === "file") return;
    const url = URL.createObjectURL(file);
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setPreviewUrl(url);
        setPreviewFailed(false);
      }
    });
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [file, kind]);
  const label = kind === "image" ? "Imagem" : kind === "video" ? "Vídeo" : kind === "audio" ? "Áudio" : file.type === "application/pdf" ? "PDF" : "Arquivo";
  return <li className="paste-preview-file">
    {previewUrl && !previewFailed && kind === "image" && <img className="paste-file-image" src={previewUrl} alt={`Prévia da imagem ${file.name || index + 1}`} onError={() => setPreviewFailed(true)} />}
    {previewUrl && !previewFailed && kind === "video" && <video className="paste-file-video" src={previewUrl} controls preload="metadata" onError={() => setPreviewFailed(true)} />}
    {previewUrl && !previewFailed && kind === "audio" && <audio className="paste-file-audio" src={previewUrl} controls preload="metadata" onError={() => setPreviewFailed(true)} />}
    {(kind === "file" || previewFailed) && <div className="paste-file-generic"><Paperclip size={24}/><span>{previewFailed ? "Prévia indisponível" : label}</span></div>}
    <div className="paste-file-meta"><Paperclip size={17}/><span>{file.name || `${label} colado ${index + 1}`}</span><small>{label} · {Math.max(1, Math.ceil(file.size / 1024))} KB</small></div>
  </li>;
}
