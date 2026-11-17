import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/baileys/baileys-client.tsx", "utf8");

describe("bandeja Baileys desconectada", () => {
  it("mantém os chats persistidos e fecha apenas a janela de envio", () => {
    expect(source).toContain('(data?.chats ?? []).map((chat) => toConversation(chat, connected))');
    expect(source).not.toMatch(/connected\s*\?\s*\(data\?\.chats\s*\?\?\s*\[\]\)/);
    expect(source).toContain("windowOpen: connected");
  });

  it("explica que o histórico continua disponível quando a sessão cai", () => {
    expect(source).toContain("Histórico salvo disponível. Conecte o WhatsApp para receber e enviar novas mensagens.");
    expect(source).toContain('role="status"');
  });
});

describe("falhas de atualização da bandeja Baileys", () => {
  it("libera a lista quando a sincronização termina ou fica parcial", () => {
    expect(source).toContain("!data.syncError && data.syncProgress < 100 && data.chats.length === 0");
    expect(source).toContain("syncError: next.syncError");
  });

  it("mostra erro do SSE e oferece nova tentativa", () => {
    expect(source).toContain("source.onerror = () => setError");
    expect(source).toContain("A atualização em tempo real foi interrompida. Tente novamente.");
    expect(source).toContain('role="alert"');
    expect(source).toContain("Tentar novamente");
    expect(source).not.toContain("load().catch(() => undefined)");
  });

  it("não ignora falha do polling de conexão", () => {
    expect(source).toContain("Não foi possível atualizar a conexão Baileys");
  });
});
