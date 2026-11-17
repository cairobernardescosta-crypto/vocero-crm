import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const dirs: string[] = [];

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("estado cifrado do Baileys", () => {
  it("não grava credenciais reutilizáveis em texto puro e consegue relê-las", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vocero-baileys-auth-"));
    dirs.push(dir);
    const { loadEncryptedAuthState } = await import("@/server/baileys/auth-state");
    const first = await loadEncryptedAuthState(dir);
    const registrationId = first.state.creds.registrationId;
    await first.saveCreds();

    const raw = await readFile(path.join(dir, "creds.json"), "utf8");
    expect(raw).toContain('"version":1');
    expect(raw).not.toContain("noiseKey");
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(["cipher", "iv", "tag", "version"]);

    const second = await loadEncryptedAuthState(dir);
    expect(second.state.creds.registrationId).toBe(registrationId);
  });

  it("falha explicitamente quando a sessão está corrompida", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vocero-baileys-auth-corrupt-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "creds.json"), "{conteudo-invalido", "utf8");
    const { loadEncryptedAuthState } = await import("@/server/baileys/auth-state");
    await expect(loadEncryptedAuthState(dir)).rejects.toThrow("Estado Baileys inválido em creds.json");
  });
});
