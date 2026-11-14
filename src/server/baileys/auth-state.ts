import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from "@whiskeysockets/baileys";
import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";

type Envelope = EncryptedValue & { version: 1 };
const locks = new Map<string, Promise<void>>();

async function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => current);
  locks.set(file, chain);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(file) === chain) locks.delete(file);
  }
}

function safeName(file: string): string {
  return file.replace(/\//g, "__").replace(/:/g, "-");
}

function isEnvelope(value: unknown): value is Envelope {
  const item = value as Partial<Envelope> | null;
  return item?.version === 1 && typeof item.cipher === "string" && typeof item.iv === "string" && typeof item.tag === "string";
}

/** Estado Baileys em arquivos separados, sempre cifrados com ENCRYPTION_KEY. */
export async function loadEncryptedAuthState(folder: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const info = await stat(folder).catch(() => null);
  if (info && !info.isDirectory()) throw new Error("BAILEYS_DATA_DIR não é um diretório");
  await mkdir(folder, { recursive: true });

  const writeData = async (data: unknown, name: string) => {
    const file = path.join(folder, safeName(name));
    await withFileLock(file, async () => {
      const encrypted = encryptSecret(JSON.stringify(data, BufferJSON.replacer));
      const envelope: Envelope = { version: 1, ...encrypted };
      await writeFile(file, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
    });
  };

  const readData = async (name: string): Promise<unknown | null> => {
    const file = path.join(folder, safeName(name));
    let legacy: unknown | null = null;
    const value = await withFileLock(file, async () => {
      try {
        const raw = await readFile(file, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (isEnvelope(parsed)) return JSON.parse(decryptSecret(parsed), BufferJSON.reviver) as unknown;
        legacy = JSON.parse(raw, BufferJSON.reviver) as unknown;
        return legacy;
      } catch {
        return null;
      }
    });
    // Migração preguiçosa dos arquivos JSON antigos, fora do mutex de leitura.
    if (legacy !== null) await writeData(legacy, name);
    return value;
  };

  const removeData = async (name: string) => {
    const file = path.join(folder, safeName(name));
    await withFileLock(file, () => unlink(file).then(() => undefined).catch(() => undefined));
  };

  // Converte imediatamente todo o estado legado; não deixa chaves antigas em texto puro.
  const existingFiles = await readdir(folder).catch(() => [] as string[]);
  for (const file of existingFiles) {
    if (file.endsWith(".json")) await readData(file);
  }

  const creds = (await readData("creds.json")) as AuthenticationState["creds"] | null ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result: Record<string, unknown> = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            result[id] = value;
          }));
          return result as never;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            const entries = data[category as keyof typeof data] as Record<string, unknown> | undefined;
            for (const id in entries) {
              const value = entries[id];
              tasks.push(value ? writeData(value, `${category}-${id}.json`) : removeData(`${category}-${id}.json`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
  };
}
