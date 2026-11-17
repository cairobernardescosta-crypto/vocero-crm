import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/app/api/baileys/route.ts", "utf8");
const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("guardas do upload Baileys", () => {
  it("rejeita Content-Length excessivo antes de materializar o multipart", () => {
    expect(route).toContain("!contentLengthHeader || !Number.isSafeInteger(contentLength) || contentLength <= 0");
    expect(route).toContain("contentLength > MAX_MULTIPART_BYTES");
    expect(route.indexOf("!contentLengthHeader")).toBeLessThan(route.indexOf("req.formData()"));
    expect(route.indexOf("contentLength > MAX_MULTIPART_BYTES")).toBeLessThan(route.indexOf("req.formData()"));
  });

  it("rejeita arquivo acima de 100 MB antes de copiar seu ArrayBuffer", () => {
    expect(route).toContain("file.size > 100 * 1024 * 1024");
    expect(route.indexOf("file.size > 100 * 1024 * 1024")).toBeLessThan(route.indexOf("file.arrayBuffer()"));
  });

  it("não devolve detalhes internos na falha genérica de mídia", () => {
    const genericCatch = route.slice(
      route.indexOf("console.warn(`[baileys] falha no envio de mídia"),
      route.indexOf("const body = await parseBody")
    );
    expect(genericCatch).toContain('apiError(409, "send_failed", "Não foi possível enviar a mídia pelo WhatsApp")');
    expect(genericCatch).not.toContain('apiError(409, "send_failed", error instanceof Error ? error.message');
  });

  it("limita áudio antes da conversão e limpa arquivo se o asset não for gravado", () => {
    const mediaSend = connector.slice(connector.indexOf("export async function sendBaileysMedia"));
    expect(mediaSend.indexOf("input.data.byteLength > MEDIA_LIMITS.audio.maxBytes")).toBeLessThan(
      mediaSend.indexOf("prepararAudioSaliente")
    );
    expect(mediaSend).toContain("await deleteMediaFile(organizationId, assetId).catch(() => undefined)");
  });
});
