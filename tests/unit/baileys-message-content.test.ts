import { describe, expect, it } from "vitest";
import { baileysMessageContent } from "../../src/server/baileys/message-content";

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

  it("preserva contatos conhecidos e ignora envelopes desconhecidos", () => {
    expect(baileysMessageContent({ contactMessage: { displayName: "Ana" } })).toEqual({ type: "unsupported", text: null, preview: "[Contato: Ana]" });
    expect(baileysMessageContent({ pollUpdateMessage: {} })).toBeNull();
  });
});
