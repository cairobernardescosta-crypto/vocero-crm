import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("página Apps", () => {
  const source = readFileSync("src/components/apps/apps-client.tsx", "utf8");

  it("oferece todas as funções internas sem simular integrações", () => {
    for (const label of ["Exportações", "E-mail Marketing", "Meta Ads", "TikTok Ads", "Integrações API", "Resultados"]) expect(source).toContain(label);
    expect(source).toContain("Não configurado");
    expect(source).toContain("Nenhum contato é enviado automaticamente");
  });

  it("consome prévia, exportação e campanhas pelo backend", () => {
    expect(source).toContain("/api/apps/preview");
    expect(source).toContain("/api/apps/export");
    expect(source).toContain("/api/apps/campaigns");
  });
});
