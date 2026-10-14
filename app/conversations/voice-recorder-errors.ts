/** Explain browser/OS microphone failures without pretending every error is a missing permission. */
export function voiceRecorderErrorMessage(error: unknown, secureContext: boolean, mediaAvailable: boolean): string {
  if (!secureContext || !mediaAvailable)
    return "O microfone exige uma conexão HTTPS confiável. Confira se o navegador mostra 'Seguro' no endereço da central e se a autoridade do certificado está instalada neste computador.";
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "Microfone bloqueado no navegador. No Chrome, abra as configurações deste site, mude Microfone para Permitir e recarregue a página. Se o site aparecer como não seguro, corrija primeiro o certificado.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "Nenhum microfone foi encontrado. Conecte ou habilite um microfone neste computador e tente novamente.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "O microfone está indisponível. Feche outros aplicativos que possam usá-lo e confira as permissões de microfone do Windows.";
  if (name === "NotSupportedError")
    return "Este navegador não oferece um formato de gravação de áudio compatível. Atualize o Chrome e tente novamente.";
  return "Não foi possível iniciar a gravação. Verifique o microfone, a permissão do navegador e tente novamente.";
}
