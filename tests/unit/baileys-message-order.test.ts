import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("ordem de persistência Baileys", () => {
  it("serializa as mensagens novas na mesma fila", () => {
    expect(connector).toContain("persistenceQueue: Promise<void>");
    expect(connector).toContain("enqueueBaileysPersistence(runtime");
    expect(connector).toContain("shouldPersistBaileysUpsert(type, message.messageTimestamp");
  });

  it("protege a prévia com comparação atômica no banco", () => {
    expect(connector).toContain("case when ${schema.baileysChat.lastMessageAt} is null");
    expect(connector).not.toContain("const isLatest = !chat.lastMessageAt");
  });
});
