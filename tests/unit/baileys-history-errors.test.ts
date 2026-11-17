import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");
const client = readFileSync("src/components/baileys/baileys-client.tsx", "utf8");

describe("histórico Baileys desativado", () => {
  it("ignora o evento histórico sem persistir mensagens", () => {
    expect(connector).toContain('socket.ev.on("messaging-history.set", () => {');
    expect(connector).toContain("O evento histórico é ignorado");
    expect(connector).not.toContain("histórico incompleto id=");
  });

  it("mantém o campo de erro compatível com sessões anteriores", () => {
    expect(connector).toContain("syncError: runtimeFor(organizationId).syncError");
    expect(client).toContain("Sincronização parcial:");
  });
});
