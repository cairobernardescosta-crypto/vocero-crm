import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("limpeza do socket Baileys", () => {
  it("remove listeners de dados e conexão antes de encerrar ou reparear", () => {
    expect(connector).toContain("function detachBaileysSocketListeners");
    for (const event of ["creds.update", "messages.upsert", "contacts.upsert", "groups.update", "messaging-history.set", "connection.update"]) {
      expect(connector).toContain(`\"${event}\"`);
    }
    expect(connector.match(/detachBaileysSocketListeners\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
