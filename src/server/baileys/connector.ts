import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { and, asc, desc, eq, inArray, isNull, notLike, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb, getSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { baileysMessageContent, unwrapBaileysMessage } from "@/server/baileys/message-content";
import { saveMediaFile } from "@/server/whatsapp/media";
import { loadEncryptedAuthState } from "@/server/baileys/auth-state";

type ConnectionStatus =
  | "disconnected"
  | "waiting_qr"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

type ReservedDb = Awaited<ReturnType<ReturnType<typeof getSql>["reserve"]>>;

type Runtime = {
  socket: import("@whiskeysockets/baileys").WASocket | null;
  qrDataUrl: string | null;
  starting: Promise<void> | null;
  manualStop: boolean;
  lock: ReservedDb | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  historyTimer: ReturnType<typeof setTimeout> | null;
  syncing: boolean;
  syncProgress: number;
  retryAttempt: number;
  backfill: Promise<void> | null;
};

const globalRuntime = globalThis as unknown as { __voceroBaileys?: Map<string, Runtime> };
const runtimes = globalRuntime.__voceroBaileys ?? new Map<string, Runtime>();
globalRuntime.__voceroBaileys = runtimes;

const logGuard = globalThis as unknown as { __voceroBaileysLogGuard?: boolean };
function installBaileysLogGuard(): void {
  if (logGuard.__voceroBaileysLogGuard) return;
  logGuard.__voceroBaileysLogGuard = true;
  const original = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first.startsWith("Closing session") || first.startsWith("Closing open session")) return;
    original(...args);
  };
}

/** Baileys/pino não pode imprimir chaves de sessão nem payloads privados. */
const silentLogger = {
  level: "silent",
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() { return silentLogger; },
};

function runtimeFor(organizationId: string): Runtime {
  const existing = runtimes.get(organizationId);
  if (existing) return existing;
  const value: Runtime = { socket: null, qrDataUrl: null, starting: null, manualStop: false, lock: null, retryTimer: null, watchdog: null, historyTimer: null, syncing: false, syncProgress: 0, retryAttempt: 0, backfill: null };
  runtimes.set(organizationId, value);
  return value;
}

function authDir(organizationId: string): string {
  const base = process.env.BAILEYS_DATA_DIR || "./.baileys-data";
  return path.resolve(base, organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

function ignoredJid(jid: string): boolean {
  return jid === "status@broadcast" || jid.endsWith("@newsletter");
}

function contactName(contact: import("@whiskeysockets/baileys").Contact): string | null {
  return contact.name ?? contact.notify ?? contact.verifiedName ?? null;
}

async function persistContact(
  organizationId: string,
  contact: import("@whiskeysockets/baileys").Contact,
  socket: import("@whiskeysockets/baileys").WASocket
): Promise<void> {
  const aliases = [...new Set([contact.id, contact.lid, contact.jid].filter((id): id is string => Boolean(id)))];
  if (!aliases.length || aliases.every(ignoredJid)) return;
  const phoneJid = contact.jid?.endsWith("@s.whatsapp.net") ? contact.jid : null;
  const phone = phoneJid?.split("@")[0] ?? null;
  let avatarUrl = contact.imgUrl && contact.imgUrl !== "changed" ? contact.imgUrl : null;
  if (!avatarUrl) {
    for (const alias of aliases) {
      try {
        avatarUrl = (await socket.profilePictureUrl(alias, "image")) ?? null;
        if (avatarUrl) break;
      } catch {}
    }
  }
  await getDb().update(schema.baileysChat).set({
    name: contactName(contact) ?? undefined,
    phone: phone ?? undefined,
    avatarUrl: avatarUrl ?? undefined,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.baileysChat.organizationId, organizationId),
    inArray(schema.baileysChat.remoteJid, aliases)
  ));
}

async function persistChatInfo(
  organizationId: string,
  chat: import("@whiskeysockets/baileys").Chat
): Promise<void> {
  if (!chat.id || ignoredJid(chat.id)) return;
  await getDb().update(schema.baileysChat).set({
    name: chat.name ?? undefined,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.baileysChat.organizationId, organizationId),
    eq(schema.baileysChat.remoteJid, chat.id)
  ));
}

/** Completa os dados já gravados antes dos eventos de contatos e mídia. */
async function backfillBaileysData(
  organizationId: string,
  socket: import("@whiskeysockets/baileys").WASocket
): Promise<void> {
  const db = getDb();
  const chats = await db.select().from(schema.baileysChat).where(and(
    eq(schema.baileysChat.organizationId, organizationId),
    notLike(schema.baileysChat.remoteJid, "%@newsletter")
  ));
  for (const chat of chats) {
    let name = chat.name;
    let participants = chat.participants;
    if (chat.isGroup) {
      try {
        const metadata = await socket.groupMetadata(chat.remoteJid);
        name = metadata.subject || name;
        participants = metadata.participants.map((participant) => ({
          jid: participant.id,
          admin: participant.admin ?? null,
        }));
      } catch {}
    }
    let avatarUrl = chat.avatarUrl;
    if (!avatarUrl) {
      try { avatarUrl = (await socket.profilePictureUrl(chat.remoteJid, "image")) ?? null; } catch {}
    }
    if (name !== chat.name || avatarUrl !== chat.avatarUrl || participants !== chat.participants) {
      await db.update(schema.baileysChat).set({
        name: name ?? undefined,
        avatarUrl: avatarUrl ?? undefined,
        participants: participants ?? undefined,
        updatedAt: new Date(),
      }).where(eq(schema.baileysChat.id, chat.id));
    }
  }

  const semArquivo = await db.select({
    id: schema.baileysMessage.id,
    type: schema.baileysMessage.type,
  }).from(schema.baileysMessage).where(and(
    eq(schema.baileysMessage.organizationId, organizationId),
    isNull(schema.baileysMessage.mediaAssetId),
    inArray(schema.baileysMessage.type, ["image", "audio", "video", "document", "sticker"])
  ));
  for (const message of semArquivo) {
    const assetId = newId("mediaAsset");
    await db.insert(schema.mediaAsset).values({
      id: assetId,
      organizationId,
      kind: message.type as "image" | "audio" | "video" | "document" | "sticker",
      fetchStatus: "failed",
      fetchError: "Mídia histórica sem chave de recuperação",
    });
    await db.update(schema.baileysMessage).set({ mediaAssetId: assetId }).where(eq(schema.baileysMessage.id, message.id));
  }
  publish(organizationId, { type: "baileys.updated", data: { status: "connected" } });
}

async function setStatus(
  organizationId: string,
  status: ConnectionStatus,
  extra: { phone?: string | null; error?: string | null } = {}
) {
  const db = getDb();
  await db
    .insert(schema.baileysConnection)
    .values({
      id: newId("baileysConnection"),
      organizationId,
      status,
      phone: extra.phone ?? null,
      error: extra.error ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.baileysConnection.organizationId,
      set: {
        status,
        ...(extra.phone !== undefined ? { phone: extra.phone } : {}),
        error: extra.error ?? null,
        updatedAt: new Date(),
      },
    });
  publish(organizationId, { type: "baileys.updated", data: { status } });
}

async function persistMessage(
  organizationId: string,
  message: import("@whiskeysockets/baileys").WAMessage,
  socket: import("@whiskeysockets/baileys").WASocket,
  options: { history?: boolean; contactName?: string | null } = {}
) {
  const jid = message.key.remoteJid;
  const providerId = message.key.id;
  if (!jid || !providerId || ignoredJid(jid)) return;
  const content = baileysMessageContent(message.message);
  if (!content) return;
  const occurredAt = new Date(Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000);
  const isGroup = jid.endsWith("@g.us");
  const phone = jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] ?? null : null;
  let name = options.contactName ?? message.pushName ?? null;
  let avatarUrl: string | null = null;
  let participants: unknown[] | null = null;
  if (!options.history) {
    try {
      avatarUrl = (await socket.profilePictureUrl(jid, "image")) ?? null;
    } catch {}
  }
  if (isGroup && !options.history) {
    try {
      const metadata = await socket.groupMetadata(jid);
      name = metadata.subject || name;
      participants = metadata.participants.map((p) => ({ jid: p.id, admin: p.admin ?? null }));
    } catch {}
  }
  const db = getDb();
  const chatId = newId("baileysChat");
  await db
    .insert(schema.baileysChat)
    .values({
      id: chatId,
      organizationId,
      remoteJid: jid,
      name,
      phone,
      isGroup,
      avatarUrl,
      participants,
      lastMessage: content.preview,
      lastMessageAt: occurredAt,
      unreadCount: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.baileysChat.organizationId, schema.baileysChat.remoteJid],
      set: {
        name: name ?? undefined,
        isGroup,
        avatarUrl: avatarUrl ?? undefined,
        participants: participants ?? undefined,
        updatedAt: new Date(),
      },
    });
  const [chat] = await db
    .select({ id: schema.baileysChat.id, lastMessageAt: schema.baileysChat.lastMessageAt })
    .from(schema.baileysChat)
    .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.remoteJid, jid)))
    .limit(1);
  if (!chat) return;
  const [existing] = await db
    .select({
      id: schema.baileysMessage.id,
      mediaAssetId: schema.baileysMessage.mediaAssetId,
      mediaStatus: schema.mediaAsset.fetchStatus,
    })
    .from(schema.baileysMessage)
    .leftJoin(schema.mediaAsset, eq(schema.baileysMessage.mediaAssetId, schema.mediaAsset.id))
    .where(and(
      eq(schema.baileysMessage.organizationId, organizationId),
      eq(schema.baileysMessage.providerId, providerId)
    ))
    .limit(1);
  if (existing?.mediaStatus === "available" || (existing && content.type === "text")) return;
  let mediaAssetId: string | null = null;
  if (["image", "audio", "video", "document", "sticker"].includes(content.type)) {
    const raw = unwrapBaileysMessage(message.message);
    const media = raw?.imageMessage ?? raw?.audioMessage ?? raw?.videoMessage ?? raw?.documentMessage ?? raw?.stickerMessage;
    const mimeType = media?.mimetype ?? null;
    const fileName = raw?.documentMessage?.fileName ?? null;
    mediaAssetId = existing?.mediaAssetId ?? newId("mediaAsset");
    let storagePath: string | null = null;
    let fileSize: number | null = null;
    let fetchStatus: "available" | "failed" = "failed";
    let fetchError: string | null = null;
    try {
      if (options.history && (!media?.mediaKey || !media.directPath)) {
        throw new Error("Mídia histórica sem chave de recuperação");
      }
      const baileys = await import("@whiskeysockets/baileys");
      const bytes = await baileys.downloadMediaMessage(message, "buffer", {}, { logger: silentLogger as never, reuploadRequest: socket.updateMediaMessage });
      storagePath = await saveMediaFile(organizationId, mediaAssetId, bytes, mimeType ?? undefined);
      fileSize = bytes.byteLength;
      fetchStatus = "available";
    } catch (error) {
      fetchError = error instanceof Error ? error.message.slice(0, 240) : "Mídia indisponível";
      if (!options.history) console.warn(`[baileys] falha ao guardar mídia (${content.type}): ${fetchError}`);
    }
    const assetValues = {
      id: mediaAssetId,
      organizationId,
      kind: content.type as "image" | "audio" | "video" | "document" | "sticker",
      mimeType,
      fileName,
      fileSize,
      caption: content.text,
      storagePath,
      fetchStatus,
      fetchError,
      updatedAt: new Date(),
    };
    if (existing?.mediaAssetId) {
      await db.update(schema.mediaAsset).set(assetValues).where(and(
        eq(schema.mediaAsset.id, existing.mediaAssetId),
        eq(schema.mediaAsset.organizationId, organizationId)
      ));
    } else {
      await db.insert(schema.mediaAsset).values(assetValues);
    }
  }
  if (existing) {
    if (mediaAssetId) {
      await db.update(schema.baileysMessage).set({ mediaAssetId }).where(eq(schema.baileysMessage.id, existing.id));
      publish(organizationId, { type: "baileys.updated", data: { chatId: chat.id, messageId: existing.id } });
    }
    return;
  }
  const messageId = newId("baileysMessage");
  const [inserted] = await db
    .insert(schema.baileysMessage)
    .values({
      id: messageId,
      organizationId,
      chatId: chat.id,
      providerId,
      direction: message.key.fromMe ? "out" : "in",
      type: content.type,
      text: content.text,
      mediaAssetId,
      status: "sent",
      occurredAt,
    })
    .onConflictDoNothing({
      target: [schema.baileysMessage.organizationId, schema.baileysMessage.providerId],
    })
    .returning({ id: schema.baileysMessage.id });
  // O gate único vem antes de contadores/prévia: uma reentrega concorrente não
  // pode incrementar não lidas nem mover a conversa duas vezes.
  if (!inserted) return;
  const isLatest = !chat.lastMessageAt || occurredAt >= chat.lastMessageAt;
  await db.update(schema.baileysChat).set({
    ...(isLatest ? { lastMessage: content.preview, lastMessageAt: occurredAt } : {}),
    ...(!options.history && !message.key.fromMe
      ? { unreadCount: sql`${schema.baileysChat.unreadCount} + 1` }
      : {}),
    updatedAt: new Date(),
  }).where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chat.id)));
  publish(organizationId, { type: "baileys.updated", data: { chatId: chat.id, messageId: inserted.id } });
}

async function startInternal(organizationId: string): Promise<void> {
  installBaileysLogGuard();
  const runtime = runtimeFor(organizationId);
  runtime.manualStop = false;
  if (!runtime.lock) {
    const reserved = await getSql().reserve();
    const result = (await reserved.unsafe(
      "select pg_try_advisory_lock(hashtext($1)) as acquired",
      [`vocero:baileys:${organizationId}`]
    )) as { acquired: boolean }[];
    if (!result[0]?.acquired) {
      reserved.release();
      await setStatus(organizationId, "error", { error: "Esta sessão já está ativa em outro processo" });
      return;
    }
    runtime.lock = reserved;
  }
  await mkdir(authDir(organizationId), { recursive: true });
  await setStatus(organizationId, "connecting");
  const baileys = await import("@whiskeysockets/baileys");
  const { state, saveCreds } = await loadEncryptedAuthState(authDir(organizationId));
  const { version } = await baileys.fetchLatestBaileysVersion();
  const socket = baileys.default({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: silentLogger as never,
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
  });
  runtime.socket = socket;
  if (runtime.watchdog) clearTimeout(runtime.watchdog);
  runtime.watchdog = setTimeout(() => {
    if (runtime.socket === socket && runtime.qrDataUrl === null) {
      console.warn("[baileys] conexão sem QR/open; reiniciando pareamento");
      socket.end(new Error("connection watchdog"));
    }
  }, 30000);
  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("messages.upsert", ({ messages, type }) => {
    const history = type !== "notify";
    for (const message of messages) void persistMessage(organizationId, message, socket, { history }).catch(() => undefined);
  });
  socket.ev.on("contacts.upsert", (contacts) => {
    for (const contact of contacts) void persistContact(organizationId, contact, socket).catch(() => undefined);
  });
  socket.ev.on("contacts.update", (contacts) => {
    for (const contact of contacts) {
      if (!contact.id) continue;
      void persistContact(organizationId, contact as import("@whiskeysockets/baileys").Contact, socket).catch(() => undefined);
    }
  });
  socket.ev.on("chats.upsert", (chats) => {
    for (const chat of chats) void persistChatInfo(organizationId, chat).catch(() => undefined);
  });
  socket.ev.on("chats.update", (chats) => {
    for (const chat of chats) {
      if (!chat.id) continue;
      void persistChatInfo(organizationId, chat as import("@whiskeysockets/baileys").Chat).catch(() => undefined);
    }
  });
  socket.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
    void persistContact(organizationId, { id: lid, lid, jid }, socket).catch(() => undefined);
  });
  socket.ev.on("messaging-history.set", ({ chats, contacts, messages, isLatest, progress }) => {
    void (async () => {
      runtime.syncing = true;
      runtime.syncProgress = Math.max(runtime.syncProgress, Math.min(99, Math.round(progress ?? 0)));
      publish(organizationId, { type: "baileys.updated", data: { status: "syncing", progress: runtime.syncProgress } });
      const names = new Map(contacts.map((contact) => [contact.id, contact.notify ?? contact.name ?? contact.verifiedName ?? null]));
      for (const contact of contacts) {
        const name = contactName(contact);
        for (const alias of [contact.id, contact.lid, contact.jid]) if (alias) names.set(alias, name);
        await persistContact(organizationId, contact, socket).catch(() => undefined);
      }
      const db = getDb();
      for (const chat of chats) {
        if (!chat.id || ignoredJid(chat.id)) continue;
        const timestamp = chat.conversationTimestamp
          ? new Date(Number(chat.conversationTimestamp) * 1000)
          : null;
        await db.insert(schema.baileysChat).values({
          id: newId("baileysChat"),
          organizationId,
          remoteJid: chat.id,
          name: chat.name ?? names.get(chat.id) ?? null,
          phone: chat.id.endsWith("@s.whatsapp.net") ? chat.id.split("@")[0] ?? null : null,
          isGroup: chat.id.endsWith("@g.us"),
          lastMessageAt: timestamp,
          unreadCount: Number(chat.unreadCount ?? 0),
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [schema.baileysChat.organizationId, schema.baileysChat.remoteJid],
          set: { name: chat.name ?? names.get(chat.id) ?? undefined, updatedAt: new Date() },
        });
        try {
          const avatarUrl = await socket.profilePictureUrl(chat.id, "image");
          if (avatarUrl) await db.update(schema.baileysChat).set({ avatarUrl }).where(and(
            eq(schema.baileysChat.organizationId, organizationId),
            eq(schema.baileysChat.remoteJid, chat.id)
          ));
        } catch {}
      }
      // Agora que os chats existem, aplica também aliases LID→telefone e
      // fotos/nome vindos do catálogo de contatos deste lote.
      for (const contact of contacts) {
        await persistContact(organizationId, contact, socket).catch(() => undefined);
      }
      const ordered = [...messages].sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0));
      for (let index = 0; index < ordered.length; index++) {
        const message = ordered[index]!;
        await persistMessage(organizationId, message, socket, {
          history: true,
          contactName: message.key.remoteJid ? names.get(message.key.remoteJid) : null,
        }).catch(() => undefined);
        if (index % 25 === 0 && ordered.length > 0) {
          runtime.syncProgress = Math.max(runtime.syncProgress, Math.round(((index + 1) / ordered.length) * 100));
          publish(organizationId, { type: "baileys.updated", data: { status: "syncing", progress: runtime.syncProgress } });
        }
      }
      if (isLatest) {
        runtime.syncing = false;
        runtime.syncProgress = 100;
      }
      publish(organizationId, { type: "baileys.updated", data: { status: runtime.syncing ? "syncing" : "connected", progress: runtime.syncProgress } });
    })().catch((error: unknown) => console.warn(`[baileys] falha ao sincronizar histórico: ${error instanceof Error ? error.message : "erro"}`));
  });
  socket.ev.on("connection.update", (update) => {
    void (async () => {
      if (update.qr) {
        if (runtime.watchdog) clearTimeout(runtime.watchdog);
        runtime.qrDataUrl = await QRCode.toDataURL(update.qr, { width: 320, margin: 2 });
        await setStatus(organizationId, "waiting_qr");
      }
      if (update.connection === "open") {
        if (runtime.watchdog) clearTimeout(runtime.watchdog);
        runtime.qrDataUrl = null;
        runtime.retryAttempt = 0;
        runtime.syncing = true;
        runtime.syncProgress = 0;
        if (runtime.historyTimer) clearTimeout(runtime.historyTimer);
        runtime.historyTimer = setTimeout(() => {
          runtime.syncing = false;
          publish(organizationId, { type: "baileys.updated", data: { status: "connected", progress: runtime.syncProgress } });
        }, 20000);
        const phone = socket.user?.id?.split(":")[0] ?? socket.user?.id?.split("@")[0] ?? null;
        await setStatus(organizationId, "connected", { phone });
        runtime.backfill ??= backfillBaileysData(organizationId, socket).finally(() => { runtime.backfill = null; });
        void runtime.backfill.catch((error: unknown) => {
          console.warn(`[baileys] falha ao completar dados existentes: ${error instanceof Error ? error.message : "erro"}`);
        });
      }
      if (update.connection === "close") {
        if (runtime.watchdog) clearTimeout(runtime.watchdog);
        runtime.socket = null;
        runtime.qrDataUrl = null;
        runtime.syncing = false;
        runtime.syncProgress = 0;
        if (runtime.historyTimer) clearTimeout(runtime.historyTimer);
        if (runtime.manualStop) {
          await setStatus(organizationId, "disconnected", { phone: null });
          return;
        }
        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number }; statusCode?: number } | undefined)?.output?.statusCode
          ?? (update.lastDisconnect?.error as { statusCode?: number } | undefined)?.statusCode;
        const invalidSession = statusCode === baileys.DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;
        console.warn(`[baileys] conexão fechada (código ${statusCode ?? "desconhecido"}); ${invalidSession ? "novo QR" : "reconexão"}`);
        if (invalidSession) await rm(authDir(organizationId), { recursive: true, force: true });
        await setStatus(organizationId, invalidSession ? "connecting" : "reconnecting", { error: statusCode ? `Desconexão ${statusCode}` : null });
        if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
        const delay = invalidSession
          ? 500
          : Math.min(60_000, 3_000 * (2 ** runtime.retryAttempt++)) + Math.floor(Math.random() * 1_000);
        runtime.retryTimer = setTimeout(() => void startBaileys(organizationId), delay);
      }
    })().catch(async (error: unknown) => {
      await setStatus(organizationId, "error", {
        error: error instanceof Error ? error.message.slice(0, 240) : "Erro de conexão",
      });
    });
  });
}

export async function startBaileys(organizationId: string): Promise<void> {
  const runtime = runtimeFor(organizationId);
  if (runtime.socket || runtime.starting) return runtime.starting ?? Promise.resolve();
  runtime.starting = startInternal(organizationId).finally(() => {
    runtime.starting = null;
  });
  return runtime.starting;
}

export async function stopBaileys(organizationId: string): Promise<void> {
  const runtime = runtimeFor(organizationId);
  runtime.manualStop = true;
  const socket = runtime.socket;
  runtime.socket = null;
  runtime.qrDataUrl = null;
  if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
  if (runtime.watchdog) clearTimeout(runtime.watchdog);
  if (runtime.historyTimer) clearTimeout(runtime.historyTimer);
  runtime.syncing = false;
  runtime.syncProgress = 0;
  if (socket) await socket.logout().catch(() => socket.end(undefined));
  await rm(authDir(organizationId), { recursive: true, force: true });
  if (runtime.lock) {
    await runtime.lock.unsafe("select pg_advisory_unlock(hashtext($1))", [`vocero:baileys:${organizationId}`]);
    runtime.lock.release();
    runtime.lock = null;
  }
  await setStatus(organizationId, "disconnected", { phone: null });
}

/** O clique em Conectar sempre inicia um pareamento limpo quando não há sessão ativa. */
export async function pairBaileys(organizationId: string): Promise<void> {
  const runtime = runtimeFor(organizationId);
  runtime.manualStop = true;
  // O socket anterior não pode disparar uma reconexão concorrente depois que
  // o novo pareamento já começou.
  runtime.socket?.ev.removeAllListeners("connection.update");
  runtime.socket?.end(new Error("new pairing requested"));
  runtime.socket = null;
  runtime.qrDataUrl = null;
  if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
  await rm(authDir(organizationId), { recursive: true, force: true });
  runtime.manualStop = false;
  await startBaileys(organizationId);
}

/** Recupera sessões que estavam ativas antes do processo Node reiniciar. */
export async function recoverBaileysConnections(): Promise<void> {
  const rows = await getDb()
    .select({ organizationId: schema.baileysConnection.organizationId })
    .from(schema.baileysConnection)
    .where(sql`${schema.baileysConnection.status} in ('connected','connecting','reconnecting','waiting_qr')`);
  for (const row of rows) {
    await startBaileys(row.organizationId).catch((error: unknown) => {
      console.warn(`[baileys] organização não recuperada: ${error instanceof Error ? error.message : "erro"}`);
    });
  }
}

export async function sendText(organizationId: string, chatId: string, text: string) {
  const runtime = runtimeFor(organizationId);
  if (!runtime.socket) throw new Error("Baileys não está conectado");
  const db = getDb();
  const [chat] = await db
    .select()
    .from(schema.baileysChat)
    .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chatId)))
    .limit(1);
  if (!chat) throw new Error("Conversa não encontrada");
  try {
    const sent = await runtime.socket.sendMessage(chat.remoteJid, { text });
    if (!sent) throw new Error("O WhatsApp não confirmou o envio");
    await persistMessage(organizationId, sent, runtime.socket);
  } catch (error) {
    const messageId = newId("baileysMessage");
    const reason = error instanceof Error ? error.message.slice(0, 240) : "Falha no envio";
    await db.insert(schema.baileysMessage).values({
      id: messageId,
      organizationId,
      chatId: chat.id,
      providerId: `failed:${messageId}`,
      direction: "out",
      type: "text",
      text,
      status: "failed",
      error: reason,
      occurredAt: new Date(),
    });
    await db
      .update(schema.baileysChat)
      .set({ lastMessage: text, lastMessageAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chat.id)));
    publish(organizationId, { type: "baileys.updated", data: { chatId: chat.id, messageId } });
    throw error;
  }
}

export async function markBaileysChatRead(organizationId: string, chatId: string): Promise<void> {
  const [chat] = await getDb()
    .update(schema.baileysChat)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chatId)))
    .returning({ id: schema.baileysChat.id });
  if (!chat) throw new Error("Conversa não encontrada");
  publish(organizationId, { type: "baileys.updated", data: { chatId } });
}

export async function setBaileysChatStage(
  organizationId: string,
  chatId: string,
  stageId: string
): Promise<void> {
  const [stage] = await getDb()
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(and(eq(schema.pipelineStage.organizationId, organizationId), eq(schema.pipelineStage.id, stageId)))
    .limit(1);
  if (!stage) throw new Error("Etapa não encontrada");
  const [chat] = await getDb()
    .update(schema.baileysChat)
    .set({ stageId: stage.id, updatedAt: new Date() })
    .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chatId)))
    .returning({ id: schema.baileysChat.id });
  if (!chat) throw new Error("Conversa não encontrada");
  publish(organizationId, { type: "baileys.updated", data: { chatId } });
}

export async function baileysSnapshot(organizationId: string, chatId?: string | null) {
  const db = getDb();
  const [connection] = await db
    .select()
    .from(schema.baileysConnection)
    .where(eq(schema.baileysConnection.organizationId, organizationId))
    .limit(1);
  const chats = await db
    .select()
    .from(schema.baileysChat)
    .where(and(
      eq(schema.baileysChat.organizationId, organizationId),
      notLike(schema.baileysChat.remoteJid, "%@newsletter")
    ))
    .orderBy(desc(schema.baileysChat.lastMessageAt))
    .limit(200);
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const messages = chatId
    ? await db
        .select()
        .from(schema.baileysMessage)
        .where(and(eq(schema.baileysMessage.organizationId, organizationId), eq(schema.baileysMessage.chatId, chatId)))
        .orderBy(schema.baileysMessage.occurredAt)
        .limit(500)
    : [];
  const assetIds = messages.flatMap((message) => message.mediaAssetId ? [message.mediaAssetId] : []);
  const assets = assetIds.length
    ? await db.select().from(schema.mediaAsset).where(and(
        eq(schema.mediaAsset.organizationId, organizationId),
        inArray(schema.mediaAsset.id, assetIds)
      ))
    : [];
  return {
    connection: connection ?? { status: "disconnected", phone: null, error: null },
    qr: runtimeFor(organizationId).qrDataUrl,
    syncing: runtimeFor(organizationId).syncing,
    syncProgress: runtimeFor(organizationId).syncProgress,
    chats: chats.map((chat) => ({
      ...chat,
      stageName: stages.find((stage) => stage.id === chat.stageId)?.name ?? null,
    })),
    stages,
    messages: messages.map((message) => ({
      ...message,
      media: assets.find((asset) => asset.id === message.mediaAssetId) ?? null,
    })),
  };
}
