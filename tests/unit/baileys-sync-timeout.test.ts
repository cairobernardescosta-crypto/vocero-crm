import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("histórico desativado no Baileys", () => {
  it("ignora lotes históricos e aceita eventos novos pelo horário", () => {
    expect(connector).toContain("shouldPersistBaileysUpsert(type, message.messageTimestamp");
    expect(connector).toContain("Regra local: o CRM começa vazio e aceita somente mensagens novas");
    expect(connector).toContain("runtime.syncing = false");
    expect(connector).toContain("runtime.syncProgress = 100");
  });
});
