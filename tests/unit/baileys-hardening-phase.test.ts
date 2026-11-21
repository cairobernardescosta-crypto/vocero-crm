import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("endurecimento do fluxo Baileys", () => {
  it("serializa atualizações de conexão e ignora eventos de sockets antigos", () => {
    expect(connector).toContain("connectionQueue: Promise<void>");
    expect(connector).toContain("runtime.connectionQueue = runtime.connectionQueue.then");
    expect(connector.match(/runtime\.socket !== socket/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("não consulta a foto do contato dentro da fila de persistência da mensagem", () => {
    const persistMessage = connector.slice(
      connector.indexOf("async function persistMessage"),
      connector.indexOf("async function startInternal")
    );
    expect(persistMessage).not.toContain("profilePictureUrl");
    expect(connector).toContain("persisted.then(() => refreshChatAvatar");
  });

  it("repete eventos auxiliares e registra a falha", () => {
    expect(connector).toContain("function persistAuxiliaryEvent");
    expect(connector).toContain("retryBaileysPersistence(task)");
    expect(connector).toContain("falha ao persistir");
  });

  it("serializa mídia enviada, remove o asset perdedor e atualiza a conversa em falha", () => {
    expect(connector).toContain("enqueueBaileysPersistence(runtime, () => retryBaileysPersistence");
    expect(connector).toContain("winner?.mediaAssetId !== assetId");
    expect(connector).toContain("Falha ao enviar [${kind}]");
  });
});
