import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const client = fs.readFileSync(path.join(root, "src/components/maps/maps-client.tsx"), "utf8");
const canvas = fs.readFileSync(path.join(root, "src/components/maps/map-canvas.tsx"), "utf8");

describe("Maps UI", () => {
  it("reutiliza contatos API e Baileys e atualiza por SSE", () => {
    expect(client).toContain("/api/maps/contacts");
    expect(client).toContain('"conversation.updated"');
    expect(client).toContain('"baileys.updated"');
  });
  it("não cria pins sem coordenadas e usa OpenFreeMap", () => {
    expect(canvas).toContain("c.latitude != null && c.longitude != null");
    expect(canvas).toContain("tiles.openfreemap.org/styles/liberty");
  });
  it("expõe as cinco áreas internas", () => {
    for (const label of ["Mapa", "Clientes", "Filtros", "Regiões e rotas", "Estatísticas"]) expect(client).toContain(label);
  });
});
