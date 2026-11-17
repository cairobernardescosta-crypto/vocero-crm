import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("limpeza de mídia órfã Baileys", () => {
  it("remove arquivo e asset quando a mensagem falha ou é duplicada", () => {
    expect(connector).toContain("const cleanupNewAsset = async () =>");
    expect(connector).toContain("await deleteMediaFile(organizationId, mediaAssetId)");
    expect(connector).toContain("await db.delete(schema.mediaAsset)");
    expect(connector.match(/await cleanupNewAsset\(\)/g)?.length).toBe(2);
  });
});
