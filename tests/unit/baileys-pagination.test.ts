import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeBaileysCursor, encodeBaileysCursor } from "@/server/baileys/connector";

describe("paginação Baileys", () => {
  it("codifica e valida cursor opaco", () => {
    const value = { t: "2026-11-15T12:00:00.000Z", id: "msg_123" };
    expect(decodeBaileysCursor(encodeBaileysCursor(value))).toEqual(value);
    expect(() => decodeBaileysCursor("inválido")).toThrow("cursor_invalid");
    expect(() => decodeBaileysCursor("x".repeat(513))).toThrow("cursor_invalid");
  });

  it("usa keyset, limites com sentinela e ordem cronológica", () => {
    const source = readFileSync("src/server/baileys/connector.ts", "utf8");
    expect(source).toContain(".limit(51)");
    expect(source).toContain(".limit(aroundMessage ? 51 : 101)");
    expect(source).toContain("desc(schema.baileysMessage.occurredAt), desc(schema.baileysMessage.id)");
    expect(source).toContain("const messages = messagePage.reverse()");
  });

  it("a interface mescla páginas e oferece carregamento acessível", () => {
    const client = readFileSync("src/components/baileys/baileys-client.tsx", "utf8");
    const list = readFileSync("src/components/inbox/conversation-list.tsx", "utf8");
    expect(list).toContain("Carregar mais conversas");
    expect(client).toContain("Carregar mensagens anteriores");
    expect(client).toContain("previous.messages.every((item) => item.chatId === chatId)");
    expect(client).toContain("page.aroundMessageId || !previousBelongsToChat ? [] : previous.messages");
    expect(client).toContain("selectedRef.current = id; setSelectedId(id)");
    expect(client).toContain('action({ action: "mark_read", chatId: id }, false)');
  });

  it("não aplica mensagens de uma resposta atrasada em outra conversa", () => {
    const client = readFileSync("src/components/baileys/baileys-client.tsx", "utf8");
    const responseRead = client.indexOf("const next = (await response.json()) as Snapshot");
    const selectionCheck = client.indexOf("const sameChat = chatId === selectedRef.current", responseRead);
    expect(responseRead).toBeGreaterThan(-1);
    expect(selectionCheck).toBeGreaterThan(responseRead);
    expect(client).toContain("if (!sameChat) return { ...previous");
    const staleBranch = client.slice(client.indexOf("if (!sameChat) return"), client.indexOf("const messageMap"));
    expect(staleBranch).not.toContain("messages: next.messages");
  });

  it("preserva a posição visual quando mensagens antigas são adicionadas", () => {
    const client = readFileSync("src/components/baileys/baileys-client.tsx", "utf8");
    const thread = readFileSync("src/components/inbox/message-thread.tsx", "utf8");
    expect(client).toContain("preserveScrollOnPrepend");
    expect(thread).toContain("el.scrollTop += el.scrollHeight - previous.height");
    expect(thread).toContain("messages.some((message) => message.id === previous.firstId)");
  });
});
