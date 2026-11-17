import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nav = readFileSync("src/components/app-nav.tsx", "utf8");
const settings = readFileSync("src/components/baileys/settings-client.tsx", "utf8");
const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("configurações exclusivas do modo Baileys", () => {
  it("abre a rota Baileys e não exibe credenciais Meta ou IA", () => {
    expect(nav).toContain('modo === "baileys" ? "/baileys/settings" : "/settings"');
    expect(settings).toContain("Configurações Baileys");
    expect(settings).not.toMatch(/WABA|Phone Number ID|token da Meta|Configurações de IA/);
  });

  it("expõe diagnóstico seguro do último evento", () => {
    expect(connector).toContain("lastUpsertAt");
    expect(connector).toContain("lastUpsertType");
    expect(settings).toContain("Último evento");
  });

  it("usa senderPn para resolver o número associado ao LID", () => {
    expect(connector).toContain("message.key.senderPn ?? message.key.participantPn");
    expect(connector).toContain("phone: phone ?? undefined");
  });
});
