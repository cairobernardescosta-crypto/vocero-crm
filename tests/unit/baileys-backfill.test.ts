import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("sincronização Baileys", () => {
  it("não executa backfill ao abrir a sessão", () => {
    expect(connector).not.toContain("if (!runtime.backfillCompleted)");
    expect(connector).toContain("syncFullHistory: false");
    expect(connector).toContain("shouldSyncHistoryMessage: () => false");
  });
});
