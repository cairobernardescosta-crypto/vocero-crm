import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connector = readFileSync("src/server/baileys/connector.ts", "utf8");

describe("reconexão Baileys", () => {
  it("captura falhas e agenda uma nova tentativa com backoff", () => {
    expect(connector).toContain("function scheduleBaileysReconnect");
    expect(connector).toContain("startBaileys(organizationId).catch");
    expect(connector).toContain("scheduleBaileysReconnect(organizationId, runtime, nextDelay)");
    expect(connector).not.toContain("setTimeout(() => void startBaileys(organizationId), delay)");
  });
});
