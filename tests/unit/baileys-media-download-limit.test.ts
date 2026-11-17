import { describe, expect, it, vi } from "vitest";
import { readBaileysMediaStream } from "@/server/baileys/connector";

async function* chunks(...values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

describe("limite de download de mídia Baileys", () => {
  it("concatena blocos dentro do limite", async () => {
    await expect(readBaileysMediaStream(chunks("abc", "def"), 6)).resolves.toEqual(Buffer.from("abcdef"));
  });

  it("interrompe antes de manter mídia acima do limite", async () => {
    const destroy = vi.fn();
    const stream = Object.assign(chunks("abc", "def"), { destroy });
    await expect(readBaileysMediaStream(stream, 5)).rejects.toMatchObject({ code: "too_large" });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
