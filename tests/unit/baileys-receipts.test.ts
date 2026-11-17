import { describe, expect, it } from "vitest";
import { baileysMessageStatus, baileysReceiptStatus } from "@/server/baileys/connector";

describe("recibos do Baileys", () => {
  it("mapeia somente estados confirmados pelo WebMessageInfo", () => {
    expect(baileysMessageStatus(0)).toBe("failed");
    expect(baileysMessageStatus(1)).toBeNull();
    expect(baileysMessageStatus(2)).toBe("sent");
    expect(baileysMessageStatus(3)).toBe("delivered");
    expect(baileysMessageStatus(4)).toBe("read");
    expect(baileysMessageStatus(5)).toBe("read");
    expect(baileysMessageStatus(undefined)).toBeNull();
  });

  it("prioriza leitura/reprodução sobre o simples recebimento", () => {
    expect(baileysReceiptStatus({ receiptTimestamp: 1 })).toBe("delivered");
    expect(baileysReceiptStatus({ receiptTimestamp: 1, readTimestamp: 2 })).toBe("read");
    expect(baileysReceiptStatus({ playedTimestamp: 3 })).toBe("read");
    expect(baileysReceiptStatus({})).toBeNull();
  });
});
