import { describe, expect, it } from "vitest";
import { buildBaileysQuotedMessage } from "@/server/baileys/connector";

describe("buildBaileysQuotedMessage", () => {
  it("monta citação de texto individual", () => {
    const result = buildBaileysQuotedMessage({ providerId: "wa-1", direction: "in", type: "text", text: "olá", senderJid: null }, "5511999999999@s.whatsapp.net");
    expect(result.quoted).toMatchObject({ key: { id: "wa-1", fromMe: false }, message: { conversation: "olá" } });
  });

  it("preserva o participante em grupo e representa mídia", () => {
    const result = buildBaileysQuotedMessage({ providerId: "wa-2", direction: "in", type: "image", text: "pedido", senderJid: "5511888888888@s.whatsapp.net" }, "120363000000@g.us");
    expect(result.quoted).toMatchObject({ key: { participant: "5511888888888@s.whatsapp.net" }, message: { imageMessage: { caption: "pedido" } } });
  });

  it("recusa citação de grupo sem participante identificável", () => {
    expect(() => buildBaileysQuotedMessage({ providerId: "wa-3", direction: "in", type: "text", text: null, senderJid: null }, "120363000000@g.us")).toThrow("participante");
  });
});
