import { describe, expect, it } from "vitest";
import { baileysMessageContent, baileysQuotedContext } from "../../src/server/baileys/message-content";

describe("conteúdo de mensagens Baileys", () => {
  it("extrai texto simples e texto dentro de envelope efêmero", () => {
    expect(baileysMessageContent({ conversation: "  olá  " })?.text).toBe("olá");
    expect(baileysMessageContent({ ephemeralMessage: { message: { extendedTextMessage: { text: "resposta" } } } })?.text).toBe("resposta");
  });

  it("ignora eventos internos que não são conversa", () => {
    expect(baileysMessageContent({ protocolMessage: { type: 0 } })).toBeNull();
    expect(baileysMessageContent({ reactionMessage: { text: "👍" } })).toBeNull();
  });

  it("preserva legenda e usa placeholders honestos para mídia", () => {
    expect(baileysMessageContent({ imageMessage: { caption: "foto do pedido" } })).toEqual({ type: "image", text: "foto do pedido", preview: "foto do pedido" });
    expect(baileysMessageContent({ audioMessage: {} })).toEqual({ type: "audio", text: null, preview: "[Áudio]" });
    expect(baileysMessageContent({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "nota.pdf" } } } })?.preview).toBe("[Documento: nota.pdf]");
  });

  it("preserva e sanitiza contatos compartilhados", () => {
    expect(baileysMessageContent({ contactMessage: { displayName: " Ana\u0000 ", vcard: "BEGIN:VCARD\nTEL;TYPE=CELL:+55 (11) 99999-9999\nEND:VCARD" } })).toEqual({
      type: "contacts",
      text: null,
      preview: "[Contato: Ana]",
      payload: [{ name: "Ana", phones: [{ phone: "+5511999999999" }] }],
    });
    expect(baileysMessageContent({ contactsArrayMessage: { contacts: [{ displayName: "Ana" }, { displayName: "Bia" }] } })?.preview).toBe("[Contatos: 2]");
    expect(baileysMessageContent({ contactMessage: { displayName: "\u202eAna", vcard: `TEL;TYPE=CELL\n${"X".repeat(70_000)}\nTEL:+5511988887777` } })?.payload).toEqual([{ name: "Ana", phones: [] }]);
    expect(baileysMessageContent({ pollUpdateMessage: {} })).toBeNull();
  });

  it("preserva localização válida e rejeita coordenadas fora do globo", () => {
    expect(baileysMessageContent({ locationMessage: { degreesLatitude: -23.55, degreesLongitude: -46.63, name: "Centro", address: "São Paulo" } })).toEqual({
      type: "location",
      text: null,
      preview: "[Localização: Centro]",
      payload: { latitude: -23.55, longitude: -46.63, name: "Centro", address: "São Paulo" },
    });
    expect(baileysMessageContent({ locationMessage: { degreesLatitude: 91, degreesLongitude: 0 } })).toEqual({ type: "unsupported", text: null, preview: "[Localização inválida]" });
  });

  it("extrai resposta citada sem guardar o payload original", () => {
    expect(baileysQuotedContext({ extendedTextMessage: {
      text: "resposta",
      contextInfo: {
        stanzaId: "WA-123",
        participant: "5511999999999@s.whatsapp.net",
        quotedMessage: { imageMessage: { caption: `foto ${"x".repeat(250)}` } },
      },
    } })).toEqual({
      providerId: "WA-123",
      participant: "5511999999999@s.whatsapp.net",
      type: "image",
      text: `foto ${"x".repeat(195)}`,
    });
    expect(baileysQuotedContext({ conversation: "sem citação" })).toBeNull();
  });
});
