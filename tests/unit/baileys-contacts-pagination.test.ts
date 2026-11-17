import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("paginação de contatos Baileys", () => {
  it("limita a API e usa cursor por chave e id", () => {
    const route = readFileSync("src/app/api/baileys/contacts/route.ts", "utf8");
    expect(route).toContain("const PAGE_SIZE = 100");
    expect(route).toContain(".limit(PAGE_SIZE + 1)");
    expect(route).toContain("nextCursor:");
  });

  it("busca no servidor e oferece carregar mais", () => {
    const client = readFileSync("src/components/baileys/contacts-client.tsx", "utf8");
    expect(client).toContain('params.set("q", query.trim())');
    expect(client).toContain("Carregar mais contatos");
  });
});
