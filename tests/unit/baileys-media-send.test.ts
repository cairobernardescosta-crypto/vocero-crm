import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { baileysMediaContent } from "@/server/baileys/connector";

describe("envio de mídia pelo Baileys", () => {
  const file = { data: Buffer.from("conteúdo"), mimeType: "application/pdf", fileName: "arquivo.pdf" };

  it("monta somente payloads nativos comprovados", () => {
    expect(baileysMediaContent("image", { ...file, mimeType: "image/jpeg" }, "foto")).toMatchObject({ caption: "foto", mimetype: "image/jpeg" });
    expect(baileysMediaContent("video", { ...file, mimeType: "video/mp4" }, "vídeo")).toMatchObject({ caption: "vídeo", mimetype: "video/mp4" });
    expect(baileysMediaContent("audio", { ...file, mimeType: "audio/ogg" }, undefined, true)).toMatchObject({ ptt: true, mimetype: "audio/ogg" });
    expect(baileysMediaContent("document", file, "anexo")).toMatchObject({ fileName: "arquivo.pdf", caption: "anexo" });
  });

  it("liga o compositor ao endpoint multipart e preserva GIF recebido", () => {
    const client = readFileSync("src/components/baileys/baileys-client.tsx", "utf8");
    const route = readFileSync("src/app/api/baileys/route.ts", "utf8");
    expect(client).toContain("media: connected");
    expect(client).toContain("mediaEndpoint={`/api/baileys?chatId=");
    expect(route).toContain('startsWith("multipart/form-data")');
    expect(route).toContain("sendBaileysMedia");
    expect(route).not.toContain("sendBaileysSticker");
    const connector = readFileSync("src/server/baileys/connector.ts", "utf8");
    const thread = readFileSync("src/components/inbox/message-thread.tsx", "utf8");
    expect(connector).toContain("gifPlayback: true");
    expect(connector).toContain('mediaKind === "sticker"');
    expect(connector).toContain("10 * 1024 * 1024");
    expect(connector).toContain("animated: true");
    expect(thread).toContain("loop={isGif}");
  });
});
