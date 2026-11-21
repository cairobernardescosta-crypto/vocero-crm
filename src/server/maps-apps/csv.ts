import type { NormalizedMapContact } from "./contacts";

export const EXPORT_FORMATS = ["contacts", "pipeline", "generic", "brevo", "mailchimp", "meta", "tiktok"] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

export const EXPORT_COLUMNS = ["name", "phone", "email", "address", "city", "neighborhood", "source", "stage", "lastInteraction", "consent"] as const;
export type ExportColumn = typeof EXPORT_COLUMNS[number];

function cell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function eligibleForFormat(contact: NormalizedMapContact, format: ExportFormat): boolean {
  if (["brevo", "mailchimp"].includes(format)) return contact.consent === "opt_in" && Boolean(contact.email);
  if (["meta", "tiktok"].includes(format)) return contact.consent === "opt_in" && Boolean(contact.phone || contact.email);
  return true;
}

export function buildContactsCsv(contacts: NormalizedMapContact[], columns: ExportColumn[]): string {
  const labels: Record<ExportColumn, string> = { name: "Nome", phone: "Telefone", email: "E-mail", address: "Endereço", city: "Cidade", neighborhood: "Bairro", source: "Conexão", stage: "Etapa", lastInteraction: "Última interação", consent: "Consentimento" };
  const rows = contacts.map((c) => columns.map((column) => {
    if (column === "name") return c.name;
    if (column === "phone") return c.phone ? `="${c.phone.replace(/"/g, '""')}"` : "";
    if (column === "email") return c.email;
    if (column === "address") return c.address;
    if (column === "city") return c.city;
    if (column === "neighborhood") return c.neighborhood;
    if (column === "source") return c.source === "baileys" ? "Baileys" : "API";
    if (column === "stage") return c.stageName;
    if (column === "lastInteraction") return c.lastInteractionAt;
    return c.consent;
  }).map(cell).join(","));
  return `\uFEFF${columns.map((c) => cell(labels[c])).join(",")}\r\n${rows.join("\r\n")}`;
}
