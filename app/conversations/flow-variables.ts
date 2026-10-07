import type { Chat } from "../conversation-model";
import type { SupportOverview } from "../dashboard-model";

type FlowProfile = SupportOverview["contacts"][number]["data"] & {
  email?: string;
  company?: string;
  document?: string;
  address?: string;
  tags?: string[];
  custom?: { label?: string; value?: string }[];
};

export function createFlowTemplate(
  operatorName: string,
  target: Chat,
  profile: FlowProfile | undefined,
  now = new Date(),
): (value?: string) => string {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", minute: "2-digit",
  }).format(now);
  const customFields = (profile?.custom || [])
    .filter(field => field.label?.trim() && field.value?.trim())
    .map(field => `${field.label}: ${field.value}`)
    .join("; ");
  const variables: Record<string, string> = {
    "{{atendente}}": operatorName,
    "{{cliente}}": target.name || "cliente",
    "{{nome}}": profile?.name || target.name || "cliente",
    "{{saudacao}}": greeting,
    "{{telefone}}": target.phone || profile?.phone || "",
    "{{email}}": profile?.email || "",
    "{{empresa}}": profile?.company || "",
    "{{documento}}": profile?.document || "",
    "{{cpf_cnpj}}": profile?.document || "",
    "{{endereco}}": profile?.address || "",
    "{{etiquetas}}": profile?.tags?.join(", ") || "",
    "{{status}}": profile?.status || "",
    "{{tipo_atendimento}}": profile?.serviceType || "",
    "{{prioridade}}": profile?.priority || "",
    "{{campos_personalizados}}": customFields,
    "{{data}}": date,
    "{{hora}}": time,
  };
  return (value = "") => {
    let result = value;
    for (const [field, replacement] of Object.entries(variables))
      result = result.split(field).join(replacement);
    return result;
  };
}
