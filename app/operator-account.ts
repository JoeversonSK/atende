import { operatorJson, operatorRequest } from "./atende-api";
import type { OperatorIdentity } from "./operator-activity";

export async function authenticateOperator(
  baseUrl: string,
  registering: boolean,
  username: string,
  displayName: string,
  password: string,
): Promise<{ user: OperatorIdentity; token: string }> {
  const endpoint = registering ? "register" : "login";
  const body = registering
    ? { username, displayName, password }
    : { username, password };
  return operatorJson(baseUrl, "", `/${endpoint}`, { method: "POST", body: JSON.stringify(body) });
}

export function updateOperatorName(baseUrl: string, token: string, displayName: string): Promise<OperatorIdentity> {
  return operatorJson(baseUrl, token, "/me", {
    method: "PUT", body: JSON.stringify({ displayName: displayName.trim() }),
  });
}

export function logoutOperator(baseUrl: string, token: string): Promise<Response> {
  return operatorRequest(baseUrl, token, "/logout", { method: "POST" });
}
