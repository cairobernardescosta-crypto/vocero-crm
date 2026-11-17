import { describe, expect, it, vi } from "vitest";
import { retryBaileysPersistence } from "@/server/baileys/connector";

describe("persistência resiliente do Baileys", () => {
  it("repete uma falha transitória e retorna o resultado sem duplicar tentativas extras", async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error("db indisponível"))
      .mockResolvedValue("ok");

    await expect(retryBaileysPersistence(task, [0, 0])).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("limita as tentativas e propaga a última falha", async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error("primeira"))
      .mockRejectedValueOnce(new Error("segunda"))
      .mockRejectedValueOnce(new Error("última"));

    await expect(retryBaileysPersistence(task, [0, 0])).rejects.toThrow("última");
    expect(task).toHaveBeenCalledTimes(3);
  });
});
