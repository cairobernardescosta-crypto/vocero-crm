import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("páginas secundárias do Baileys", () => {
  for (const file of ["contacts-client.tsx", "results-client.tsx"]) {
    it(`${file} atualiza por evento e permite tentar novamente`, () => {
      const source = readFileSync(`src/components/baileys/${file}`, "utf8");
      expect(source).toContain('new EventSource("/api/events")');
      expect(source).toContain('addEventListener("baileys.updated"');
      expect(source).toContain("Tentar novamente");
    });
  }
});
