import { errorMessage, request, type ApiConfig } from "../atende-api";
import type { SupportOverview } from "../dashboard-model";
import type { ConversationFlow, ConversationFlowStep } from "../flow-settings";
import { signOutgoingText } from "./message-delivery";
import { closeTicket, type Assignment } from "./ticket-actions";

type ProfileData = SupportOverview["contacts"][number]["data"];
type StartedTicket = { data: ProfileData; assignment: Assignment; message?: string };
export type FlowExecutionResult = {
  assignedByFlow: boolean;
  closedByFlow: boolean;
  waitingForAnswer: boolean;
  evaluation: boolean;
};

function prepareRemainingSteps(
  steps: ConversationFlowStep[],
  operatorName: string,
  fill: (value?: string) => string,
  flowId: string,
  selectedCnpjs?: string[],
): ConversationFlowStep[] {
  return steps.map(step => {
    if ((step.type || "message") === "message")
      return { ...step, text: signOutgoingText(operatorName, fill(step.text)) };
    if (step.type === "sheet") return { ...step, flowId };
    if (step.type === "monthly-complete") return { ...step, flowId, selectedCnpjs };
    if (step.type === "poll")
      return { ...step, question: fill(step.question), options: (step.options || []).map(fill) };
    if (["image", "video", "audio", "document"].includes(step.type || "")) {
      const caption = fill(step.caption);
      return { ...step, caption: caption ? signOutgoingText(operatorName, caption) : "" };
    }
    return step;
  });
}

export async function executeConversationFlow({
  config, flow, chatId, operatorName, fill, selectedCnpjs, onAssigned, onClosed,
}: {
  config: ApiConfig;
  flow: ConversationFlow;
  chatId: string;
  operatorName: string;
  fill: (value?: string) => string;
  selectedCnpjs?: string[];
  onAssigned: (started: StartedTicket) => void;
  onClosed: (data: ProfileData, evaluation: boolean) => void;
}): Promise<FlowExecutionResult> {
  const contactPath = `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(chatId)}`;
  let assignedByFlow = false;
  let closedByFlow = false;
  let waitingForAnswer = false;

  const assignToCurrent = async () => {
    if (assignedByFlow) return;
    const response = await request(config, `${contactPath}/start`, { method: "POST" });
    const started = await response.json() as StartedTicket;
    if (!response.ok) throw new Error(errorMessage(started));
    assignedByFlow = true;
    onAssigned(started);
  };
  const closeFromFlow = async () => {
    if (closedByFlow) return;
    const data = await closeTicket(config, chatId);
    closedByFlow = true;
    onClosed(data, false);
  };

  if (flow.kind === "evaluation") {
    const response = await request(config, `${contactPath}/evaluation`, { method: "POST" });
    const closed = await response.json() as { data: ProfileData; message?: string };
    if (!response.ok) throw new Error(errorMessage(closed));
    onClosed(closed.data, true);
    return { assignedByFlow, closedByFlow, waitingForAnswer, evaluation: true };
  }
  if (flow.kind === "start") await assignToCurrent();

  for (let stepIndex = 0; stepIndex < flow.steps.length; stepIndex += 1) {
    const step = flow.steps[stepIndex];
    const type = step.type || "message";
    if (type === "delay") {
      if ((step.delaySeconds || 0) > 0)
        await new Promise(resolve => setTimeout(resolve, (step.delaySeconds || 0) * 1000));
      continue;
    }
    if ((step.delaySeconds || 0) > 0)
      await new Promise(resolve => setTimeout(resolve, (step.delaySeconds || 0) * 1000));
    if (type === "action") {
      if (step.action === "assign-current") await assignToCurrent();
      else if (step.action === "close-ticket") await closeFromFlow();
      continue;
    }
    if (type === "sheet" || type === "monthly-complete") {
      const response = await request(config, `${contactPath}/flow-sheet/${encodeURIComponent(flow.id)}/${encodeURIComponent(step.id)}`, { method: "POST",
        ...(type === "monthly-complete" ? { body: JSON.stringify({ selectedCnpjs }) } : {}) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      continue;
    }

    let path = "send-text";
    let body: Record<string, unknown> = { chatId };
    if (type === "message")
      body.text = signOutgoingText(operatorName, fill(step.text));
    else if (type === "poll") {
      path = "send-poll";
      body = { chatId, name: fill(step.question), options: (step.options || []).map(fill), allowMultipleAnswers: false };
    } else {
      path = `send-${type}`;
      const caption = fill(step.caption);
      body = {
        chatId,
        base64: step.data,
        mimetype: step.mimetype || "application/octet-stream",
        filename: step.filename || "arquivo",
        ...(caption ? { caption: signOutgoingText(operatorName, caption) } : {}),
      };
    }
    const response = await request(config,
      `/sessions/${encodeURIComponent(config.sessionId)}/messages/${path}`,
      { method: "POST", body: JSON.stringify(body) });
    const sent = await response.json().catch(() => null) as { messageId?: string; message?: string } | null;
    if (!response.ok) throw new Error(errorMessage(sent));

    if (type === "poll") {
      const continuation = await request(config, `${contactPath}/flow-continuation`, {
        method: "POST",
        body: JSON.stringify({
          steps: prepareRemainingSteps(flow.steps.slice(stepIndex + 1), operatorName, fill, flow.id, selectedCnpjs),
          expectedOptions: (step.options || []).map(fill),
          pollMessageId: sent?.messageId,
        }),
      });
      if (!continuation.ok)
        throw new Error(errorMessage(await continuation.json().catch(() => null)));
      waitingForAnswer = true;
      break;
    }
  }
  return { assignedByFlow, closedByFlow, waitingForAnswer, evaluation: false };
}
