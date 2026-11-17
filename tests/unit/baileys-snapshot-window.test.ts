import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("janela de mensagens do snapshot Baileys", () => {
  it("seleciona a janela recente e só então devolve a ordem cronológica", () => {
    const source = readFileSync("src/server/baileys/connector.ts", "utf8");
    const snapshot = source.slice(source.indexOf("export async function baileysSnapshot"));

    expect(snapshot).toContain(
      "orderBy(desc(schema.baileysMessage.occurredAt), desc(schema.baileysMessage.id))"
    );
    expect(snapshot).toMatch(/\.limit\(aroundMessage \? 51 : 101\)[\s\S]*const messages = messagePage\.reverse\(\)/);
    expect(snapshot).not.toContain(".orderBy(schema.baileysMessage.occurredAt)\n        .limit(500)");
  });
});
