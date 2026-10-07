import { errorMessage, request, type ApiConfig } from "../atende-api";
import type { SupportOverview } from "../dashboard-model";

type ProfileData = SupportOverview["contacts"][number]["data"];
export type NewContact = { id: string; name: string; phone: string };

export function prepareNewContact(
  firstName: string,
  lastName: string,
  countryCodeInput: string,
  phoneInput: string,
): NewContact {
  const countryCode = countryCodeInput.replace(/\D/g, "");
  const typedNumber = phoneInput.replace(/\D/g, "");
  const nationalMin = ({ 55: 10, 1: 10, 351: 9, 34: 9, 54: 10 } as Record<string, number>)[countryCodeInput] || 9;
  const nationalMax = ({ 55: 11, 1: 10, 351: 9, 34: 9, 54: 11 } as Record<string, number>)[countryCodeInput] || 11;
  const number = phoneInput.trim().startsWith("+") ||
    (typedNumber.startsWith(countryCode) && typedNumber.length > nationalMax)
    ? typedNumber : `${countryCode}${typedNumber}`;
  const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  if (!firstName.trim()) throw new Error("Informe o primeiro nome do contato.");
  const nationalNumber = number.startsWith(countryCode) ? number.slice(countryCode.length) : "";
  if (!/^\d{10,15}$/.test(number) || nationalNumber.length < nationalMin || nationalNumber.length > nationalMax)
    throw new Error("Informe um número válido com DDD.");
  return { id: `${number}@c.us`, name, phone: number };
}

export async function saveNewContact(config: ApiConfig, contact: NewContact): Promise<ProfileData> {
  const path = `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(contact.id)}`;
  const current = await request(config, path);
  const profile = await current.json() as { revision?: number; data: ProfileData };
  if (!current.ok) throw new Error(errorMessage(profile));
  const response = await request(config, path, {
    method: "PUT",
    body: JSON.stringify({
      ...profile,
      data: { ...profile.data, name: contact.name, phone: contact.phone },
    }),
  });
  const saved = await response.json() as { data: ProfileData };
  if (!response.ok) throw new Error(errorMessage(saved));
  return saved.data;
}
