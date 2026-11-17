import { describe, expect, it } from "vitest";
import { shouldSuppressBaileysConsoleLog } from "@/server/baileys/connector";

describe("proteção dos logs de sessão Baileys", () => {
  it.each([
    "Closing session: secret",
    "Closing open session: secret",
    "Removing old closed session: secret",
  ])("bloqueia logs que carregam material criptográfico: %s", (message) => {
    expect(shouldSuppressBaileysConsoleLog(message)).toBe(true);
  });

  it("preserva logs operacionais sem segredos", () => {
    expect(shouldSuppressBaileysConsoleLog("Baileys conectado")).toBe(false);
    expect(shouldSuppressBaileysConsoleLog({ status: "connected" })).toBe(false);
  });
});
