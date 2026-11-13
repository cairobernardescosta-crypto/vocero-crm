const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseBaileysFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function baileysEnabled(): boolean {
  return parseBaileysFlag(process.env.BAILEYS_ENABLED);
}

export function baileysDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
