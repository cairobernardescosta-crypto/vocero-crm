import { describe, expect, it } from "vitest";
import { isEmojiOnly } from "@/components/inbox/message-thread";

describe("tamanho de mensagens com emoji", () => {
  it("reconhece emojis isolados e sequências combinadas", () => {
    expect(isEmojiOnly("😄")).toBe(true);
    expect(isEmojiOnly("👨‍👩‍👧‍👦 👍🏽")).toBe(true);
    expect(isEmojiOnly("🇧🇷")).toBe(true);
  });

  it("mantém texto comum no tamanho normal", () => {
    expect(isEmojiOnly("Olá 😄")).toBe(false);
    expect(isEmojiOnly("123")).toBe(false);
    expect(isEmojiOnly(null)).toBe(false);
  });
});
