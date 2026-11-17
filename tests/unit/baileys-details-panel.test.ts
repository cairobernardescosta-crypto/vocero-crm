import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("painel de detalhes Baileys", () => {
  const client = readFileSync("src/components/baileys/baileys-client.tsx", "utf8");
  const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

  it("abre pelo cabeçalho e oferece fechamento acessível", () => {
    expect(client).toContain('aria-controls="baileys-chat-details"');
    expect(client).toContain('aria-label="Fechar detalhes"');
    expect(client).toContain('event.key !== "Escape"');
    expect(client).toContain("detailsTriggerRef.current?.focus()");
  });

  it("exibe somente dados reais e papéis conhecidos do grupo", () => {
    expect(connector).toContain("selectedDetails");
    expect(connector).toContain("chatByJid.get(participant.jid)");
    expect(client).toContain('participant.admin === "superadmin" ? "Criador" : "Admin"');
    expect(client).toContain('participant.phone ? formatPhone(participant.phone) : "Participante"');
    expect(client).not.toContain("Promover participante");
    expect(client).not.toContain("Remover participante");
  });

  it("não expõe JID técnico na prévia do cabeçalho", () => {
    expect(client).toContain("participantPreview");
    expect(client).not.toContain('p.jid.split("@")[0]');
    expect(client).not.toContain('title={selectedChat.participants.map((p) => p.jid)');
  });
});
