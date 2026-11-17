import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("regra Baileys somente mensagens novas", () => {
  it("desliga o histórico e ignora upserts que não sejam notify", () => {
    expect(connector).toContain("syncFullHistory: false");
    expect(connector).toContain("shouldSyncHistoryMessage: () => false");
    expect(connector).toContain('if (type !== "notify") return');
  });

  it("encerra a sessão com limite e limpa credenciais para um novo QR", () => {
    expect(connector).toContain("Tempo limite ao desconectar o WhatsApp");
    expect(connector).toContain("await closeBaileysSocket(socket)");
    expect(connector).toContain("await rm(authDir(organizationId), { recursive: true, force: true })");
  });
});
