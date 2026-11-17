import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldPersistBaileysUpsert } from "@/server/baileys/connector";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("regra Baileys somente mensagens novas", () => {
  it("desliga o histórico e aceita notify/append somente após a conexão", () => {
    expect(connector).toContain("syncFullHistory: false");
    expect(connector).toContain("shouldSyncHistoryMessage: () => false");
    const cutoff = Date.UTC(2026, 10, 17, 12, 0, 0);
    expect(shouldPersistBaileysUpsert("notify", cutoff / 1000, cutoff)).toBe(true);
    expect(shouldPersistBaileysUpsert("append", cutoff / 1000 + 1, cutoff)).toBe(true);
    expect(shouldPersistBaileysUpsert("append", cutoff / 1000 - 1, cutoff)).toBe(true);
    expect(shouldPersistBaileysUpsert("prepend", cutoff / 1000 + 1, cutoff)).toBe(false);
  });

  it("encerra a sessão com limite e limpa credenciais para um novo QR", () => {
    expect(connector).toContain("Tempo limite ao desconectar o WhatsApp");
    expect(connector).toContain("await closeBaileysSocket(socket)");
    expect(connector).toContain("await rm(authDir(organizationId), { recursive: true, force: true })");
  });
});
