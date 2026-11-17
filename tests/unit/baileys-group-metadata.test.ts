import { describe, expect, it } from "vitest";
import { ignoredJid } from "@/server/baileys/connector";

describe("bloqueio de grupos Baileys", () => {
  it("ignora grupos, status e canais, mas aceita contatos individuais", () => {
    expect(ignoredJid("120363000000@g.us")).toBe(true);
    expect(ignoredJid("status@broadcast")).toBe(true);
    expect(ignoredJid("canal@newsletter")).toBe(true);
    expect(ignoredJid("5511999999999@s.whatsapp.net")).toBe(false);
  });
});
