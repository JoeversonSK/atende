import { errorMessage, request, type ApiConfig } from "../atende-api";
import type { SupportOverview } from "../dashboard-model";

export type Assignment = {
  assigneeName: string;
  assigneeId?: string;
  updatedAt?: string;
};

export type AssignedConversation = Assignment & {
  reopened?: boolean;
  profileData?: SupportOverview["contacts"][number]["data"];
};

export type AssignmentRow = Assignment & { chatId: string };

export async function listAssignments(config: ApiConfig): Promise<AssignmentRow[] | null> {
  const response = await request(config,
    `/sessions/${encodeURIComponent(config.sessionId)}/conversations/assignments`);
  return response.ok ? await response.json() as AssignmentRow[] : null;
}

function assignmentPath(config: ApiConfig, chatId: string): string {
  return `/sessions/${encodeURIComponent(config.sessionId)}/conversations/${encodeURIComponent(chatId)}/assignment`;
}

export async function readAssignment(config: ApiConfig, chatId: string): Promise<Assignment | null | undefined> {
  const response = await request(config, assignmentPath(config, chatId));
  return response.ok ? await response.json() as Assignment | null : undefined;
}

export async function assignConversation(
  config: ApiConfig,
  chatId: string,
  assigneeName: string,
  assigneeId: string,
): Promise<AssignedConversation> {
  const response = await request(config, assignmentPath(config, chatId), {
    method: "PUT",
    body: JSON.stringify({ assigneeName, assigneeId }),
  });
  if (!response.ok)
    throw new Error(errorMessage(await response.json().catch(() => null)));
  return response.json() as Promise<AssignedConversation>;
}

export async function removeAssignment(config: ApiConfig, chatId: string): Promise<void> {
  const response = await request(config, assignmentPath(config, chatId), { method: "DELETE" });
  if (!response.ok)
    throw new Error(errorMessage(await response.json().catch(() => null)));
}

export async function closeTicket(
  config: ApiConfig,
  chatId: string,
): Promise<SupportOverview["contacts"][number]["data"]> {
  const response = await request(config,
    `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(chatId)}/close`,
    { method: "POST" });
  const result = await response.json() as { data: SupportOverview["contacts"][number]["data"] };
  if (!response.ok) throw new Error(errorMessage(result));
  return result.data;
}
