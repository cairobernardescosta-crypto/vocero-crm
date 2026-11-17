import path from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";
import { and, asc, desc, eq, inArray, isNull, notLike, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb, getSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { baileysMessageContent, baileysQuotedContext, unwrapBaileysMessage } from "@/server/baileys/message-content";
import { deleteMediaFile, MEDIA_LIMITS, saveMediaFile, validateOutgoing, MediaValidationError } from "@/server/whatsapp/media";
import { prepararAudioSaliente } from "@/server/whatsapp/nota-de-voz";
import { loadEncryptedAuthState } from "@/server/baileys/auth-state";

type ConnectionStatus =
  | "disconnected"
  | "waiting_qr"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

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
  syncFailures: number;
  syncError: string | null;
  historyObserved: boolean;
  retryAttempt: number;
  backfill: Promise<void> | null;
  backfillCompleted: boolean;
  persistenceQueue: Promise<void>;
  acceptMessagesAfter: number | null;
  lastUpsertAt: Date | null;
  lastUpsertType: string | null;
};

const globalRuntime = globalThis as unknown as { __voceroBaileys?: Map<string, Runtime> };
const runtimes = globalRuntime.__voceroBaileys ?? new Map<string, Runtime>();
globalRuntime.__voceroBaileys = runtimes;

const logGuard = globalThis as unknown as { __voceroBaileysLogGuard?: boolean };

/** Repetição curta e limitada; as gravações Baileys são idempotentes por providerId. */
export async function retryBaileysPersistence<T>(
  task: () => Promise<T>,
  delays: readonly number[] = [250, 1000]
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < delays.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }
  throw lastError;
}

/** Lê mídia em blocos e interrompe o stream antes de ultrapassar o limite. */
export async function readBaileysMediaStream(
  stream: AsyncIterable<Uint8Array | string> & { destroy?: (error?: Error) => void },
  maxBytes: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) {
      const error = new MediaValidationError("too_large", "A mídia recebida excede o limite permitido");
      stream.destroy?.(error);
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

export function shouldSuppressBaileysConsoleLog(first: unknown): boolean {
  if (typeof first !== "string") return false;
  return [
    "Closing session",
    "Closing open session",
    "Removing old closed session",
  ].some((prefix) => first.startsWith(prefix));
}

function installBaileysLogGuard(): void {
  if (logGuard.__voceroBaileysLogGuard) return;
  logGuard.__voceroBaileysLogGuard = true;
  const original = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    if (shouldSuppressBaileysConsoleLog(args[0])) return;
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
  const value: Runtime = { socket: null, qrDataUrl: null, starting: null, manualStop: false, lock: null, retryTimer: null, watchdog: null, historyTimer: null, syncing: false, syncProgress: 0, syncFailures: 0, syncError: null, historyObserved: false, retryAttempt: 0, backfill: null, backfillCompleted: false, persistenceQueue: Promise.resolve(), acceptMessagesAfter: null, lastUpsertAt: null, lastUpsertType: null };
  runtimes.set(organizationId, value);
  return value;
}

function enqueueBaileysPersistence<T>(runtime: Runtime, task: () => Promise<T>): Promise<T> {
  const current = runtime.persistenceQueue.then(task, task);
  runtime.persistenceQueue = current.then(() => undefined, () => undefined);
  return current;
}

function scheduleBaileysReconnect(organizationId: string, runtime: Runtime, delay: number): void {
  if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
  runtime.retryTimer = setTimeout(() => {
    runtime.retryTimer = null;
    void startBaileys(organizationId).catch(async (error: unknown) => {
      const reason = error instanceof Error ? error.message.slice(0, 160) : "erro desconhecido";
      console.warn(`[baileys] tentativa de reconexão falhou: ${reason}`);
      await setStatus(organizationId, "reconnecting", { error: reason }).catch(() => undefined);
      const nextDelay = Math.min(60_000, 3_000 * (2 ** runtime.retryAttempt++)) + Math.floor(Math.random() * 1_000);
      scheduleBaileysReconnect(organizationId, runtime, nextDelay);
    });
  }, delay);
}

function detachBaileysSocketListeners(socket: import("@whiskeysockets/baileys").WASocket): void {
  const events: Array<keyof import("@whiskeysockets/baileys").BaileysEventMap> = [
    "creds.update",
    "messages.upsert",
    "messages.update",
    "message-receipt.update",
    "contacts.upsert",
    "contacts.update",
    "chats.upsert",
    "chats.update",
    "groups.upsert",
    "groups.update",
    "group-participants.update",
    "messaging-history.set",
    "connection.update",
  ];
  for (const event of events) socket.ev.removeAllListeners(event);
}

async function closeBaileysSocket(socket: import("@whiskeysockets/baileys").WASocket): Promise<void> {
  detachBaileysSocketListeners(socket);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      socket.logout(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Tempo limite ao desconectar o WhatsApp")), 5000);
      }),
    ]);
  } catch (error) {
    console.warn(`[baileys] encerramento remoto incompleto: ${error instanceof Error ? error.message : "erro"}`);
  } finally {
    if (timer) clearTimeout(timer);
    socket.end(undefined);
  }
}

function authRoot(): string {
  return path.resolve(process.env.BAILEYS_DATA_DIR || "./.baileys-data");
}

function authDir(organizationId: string): string {
  return path.join(authRoot(), organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

export function ignoredJid(jid: string): boolean {
  return jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@g.us");
}

export function shouldPersistBaileysUpsert(
  type: string,
  _messageTimestamp?: unknown,
  _acceptMessagesAfter?: number | null
): boolean {
  // O histórico completo chega por `messaging-history.set`, que é ignorado.
  // `append` também pode carregar mensagens novas que ficaram aguardando no
  // servidor enquanto o aparelho estava offline; não filtre pelo relógio.
  return type === "notify" || type === "append";
}

/** Mapeia somente confirmações documentadas em WebMessageInfo.Status. */
export function baileysMessageStatus(status: number | null | undefined): DeliveryStatus | null {
  if (status === 0) return "failed";
  if (status === 2) return "sent";
  if (status === 3) return "delivered";
  if (status === 4 || status === 5) return "read";
  return null;
}

export function baileysReceiptStatus(receipt: {
  receiptTimestamp?: unknown;
  readTimestamp?: unknown;
  playedTimestamp?: unknown;
}): DeliveryStatus | null {
  if (receipt.readTimestamp != null || receipt.playedTimestamp != null) return "read";
  if (receipt.receiptTimestamp != null) return "delivered";
  return null;
}

async function updateDeliveryStatus(
  organizationId: string,
  providerId: string | null | undefined,
  status: DeliveryStatus | null
): Promise<void> {
  if (!providerId || !status) return;
  const previous = status === "read"
    ? ["pending", "sent", "delivered"] as const
    : status === "delivered"
      ? ["pending", "sent"] as const
      : status === "sent"
        ? ["pending"] as const
        : ["pending", "sent"] as const;
  const [updated] = await getDb()
    .update(schema.baileysMessage)
    .set({ status, error: status === "failed" ? "O WhatsApp informou falha no envio" : null })
    .where(and(
      eq(schema.baileysMessage.organizationId, organizationId),
      eq(schema.baileysMessage.providerId, providerId),
      eq(schema.baileysMessage.direction, "out"),
      inArray(schema.baileysMessage.status, [...previous])
    ))
    .returning({ chatId: schema.baileysMessage.chatId, id: schema.baileysMessage.id });
  if (updated) publish(organizationId, { type: "baileys.updated", data: { chatId: updated.chatId, messageId: updated.id } });
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
  const providerName = contactName(contact);
  await getDb().update(schema.baileysChat).set({
    name: providerName ? sql`coalesce(${schema.baileysChat.name}, ${providerName})` : undefined,
    phone: phone ? sql`coalesce(${schema.baileysChat.phone}, ${phone})` : undefined,
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
  const rawTimestamp = Number(chat.conversationTimestamp ?? 0);
  const lastMessageAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0
    ? new Date(rawTimestamp * 1000)
    : undefined;
  await getDb().update(schema.baileysChat).set({
    name: chat.name ?? undefined,
    lastMessageAt,
    unreadCount: chat.unreadCount == null ? undefined : Number(chat.unreadCount),
    updatedAt: new Date(),
  }).where(and(
    eq(schema.baileysChat.organizationId, organizationId),
    eq(schema.baileysChat.remoteJid, chat.id)
  ));
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
  const quoted = baileysQuotedContext(message.message);
  const occurredAt = new Date(Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000);
  const isGroup = jid.endsWith("@g.us");
  const phoneJid = jid.endsWith("@s.whatsapp.net")
    ? jid
    : !message.key.fromMe
      ? message.key.senderPn ?? message.key.participantPn ?? null
      : null;
  const phone = phoneJid?.endsWith("@s.whatsapp.net") ? phoneJid.split("@")[0] ?? null : null;
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
        name: name ? sql`coalesce(${schema.baileysChat.name}, ${name})` : undefined,
        phone: phone ? sql`coalesce(${schema.baileysChat.phone}, ${phone})` : undefined,
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
    const mediaKind = content.type as "image" | "audio" | "video" | "document" | "sticker";
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
      // Stickers animados (frequentemente chamados de GIF no WhatsApp) podem
      // ultrapassar o limite de 100 KB da Cloud API. No recebimento Baileys,
      // mantemos um teto próprio e seguro para não descartá-los.
      const maxBytes = mediaKind === "sticker"
        ? 10 * 1024 * 1024
        : mediaKind === "video"
          ? 64 * 1024 * 1024
          : MEDIA_LIMITS[mediaKind].maxBytes;
      const declaredSize = Number(media?.fileLength ?? 0);
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        throw new MediaValidationError("too_large", "A mídia recebida excede o limite permitido");
      }
      const baileys = await import("@whiskeysockets/baileys");
      const stream = await baileys.downloadMediaMessage(message, "stream", {}, { logger: silentLogger as never, reuploadRequest: socket.updateMediaMessage });
      const bytes = await readBaileysMediaStream(stream, maxBytes);
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
      kind: mediaKind,
      mimeType,
      fileName,
      fileSize,
      caption: content.text,
      payload: mediaKind === "video" && raw?.videoMessage?.gifPlayback
        ? { gifPlayback: true }
        : mediaKind === "sticker" && raw?.stickerMessage?.isAnimated
          ? { animated: true }
          : null,
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
  } else if (content.type === "location" || content.type === "contacts") {
    mediaAssetId = existing?.mediaAssetId ?? newId("mediaAsset");
    const assetValues = {
      id: mediaAssetId,
      organizationId,
      kind: content.type,
      payload: content.payload ?? null,
      fetchStatus: "available" as const,
      fetchError: null,
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
  const cleanupNewAsset = async () => {
    if (!mediaAssetId) return;
    await deleteMediaFile(organizationId, mediaAssetId).catch(() => undefined);
    await db.delete(schema.mediaAsset).where(and(
      eq(schema.mediaAsset.organizationId, organizationId),
      eq(schema.mediaAsset.id, mediaAssetId)
    ));
  };
  let inserted: { id: string } | undefined;
  try {
    [inserted] = await db
      .insert(schema.baileysMessage)
      .values({
        id: messageId,
        organizationId,
        chatId: chat.id,
        providerId,
        senderJid: message.key.participant ?? (message.key.fromMe ? socket.user?.id ?? null : jid),
        direction: message.key.fromMe ? "out" : "in",
        type: content.type,
        text: content.text,
        replyToProviderId: quoted?.providerId ?? null,
        replyToType: quoted?.type ?? null,
        replyToText: quoted?.text ?? null,
        mediaAssetId,
        status: "sent",
        occurredAt,
      })
      .onConflictDoNothing({
        target: [schema.baileysMessage.organizationId, schema.baileysMessage.providerId],
      })
      .returning({ id: schema.baileysMessage.id });
  } catch (error) {
    await cleanupNewAsset();
    throw error;
  }
  // O gate único vem antes de contadores/prévia: uma reentrega concorrente não
  // pode incrementar não lidas nem mover a conversa duas vezes.
  if (!inserted) {
    await cleanupNewAsset();
    return;
  }
  await db.update(schema.baileysChat).set({
    lastMessage: sql`case when ${schema.baileysChat.lastMessageAt} is null or ${schema.baileysChat.lastMessageAt} <= ${occurredAt} then ${content.preview} else ${schema.baileysChat.lastMessage} end`,
    lastMessageAt: sql`case when ${schema.baileysChat.lastMessageAt} is null or ${schema.baileysChat.lastMessageAt} <= ${occurredAt} then ${occurredAt} else ${schema.baileysChat.lastMessageAt} end`,
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
  // Tolera mensagens que chegaram durante o handshake, mas recusa qualquer
  // lote histórico anterior à conexão atual.
  runtime.acceptMessagesAfter = Date.now() - 30_000;
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
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
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
    runtime.lastUpsertAt = new Date();
    runtime.lastUpsertType = type;
    for (const message of messages) {
      if (!shouldPersistBaileysUpsert(type, message.messageTimestamp, runtime.acceptMessagesAfter)) continue;
      void enqueueBaileysPersistence(runtime, () => retryBaileysPersistence(() => persistMessage(organizationId, message, socket)))
        .catch((error: unknown) => {
          const providerId = message.key.id ?? "sem-id";
          const reason = error instanceof Error ? error.message.slice(0, 160) : "erro desconhecido";
          console.error(`[baileys] falha ao persistir mensagem org=${organizationId} id=${providerId}: ${reason}`);
        });
    }
  });
  socket.ev.on("messages.update", (updates) => {
    for (const { key, update } of updates) {
      void updateDeliveryStatus(organizationId, key.id, baileysMessageStatus(update.status))
        .catch((error: unknown) => console.warn(`[baileys] falha ao atualizar recibo: ${error instanceof Error ? error.message.slice(0, 160) : "erro"}`));
    }
  });
  socket.ev.on("message-receipt.update", (updates) => {
    for (const { key, receipt } of updates) {
      void updateDeliveryStatus(organizationId, key.id, baileysReceiptStatus(receipt))
        .catch((error: unknown) => console.warn(`[baileys] falha ao atualizar confirmação: ${error instanceof Error ? error.message.slice(0, 160) : "erro"}`));
    }
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
  socket.ev.on("messaging-history.set", () => {
    // Regra local: o CRM começa vazio e aceita somente mensagens novas.
    // O evento histórico é ignorado mesmo se o provedor o emitir inesperadamente.
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
        runtime.syncing = false;
        runtime.syncProgress = 100;
        runtime.syncFailures = 0;
        runtime.syncError = null;
        runtime.historyObserved = false;
        if (runtime.historyTimer) clearTimeout(runtime.historyTimer);
        const phone = socket.user?.id?.split(":")[0] ?? socket.user?.id?.split("@")[0] ?? null;
        await setStatus(organizationId, "connected", { phone });
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
        const delay = invalidSession
          ? 500
          : Math.min(60_000, 3_000 * (2 ** runtime.retryAttempt++)) + Math.floor(Math.random() * 1_000);
        scheduleBaileysReconnect(organizationId, runtime, delay);
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
  runtime.acceptMessagesAfter = null;
  runtime.backfillCompleted = false;
  if (socket) {
    await closeBaileysSocket(socket);
  }
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
  if (runtime.socket) {
    detachBaileysSocketListeners(runtime.socket);
    runtime.socket.end(new Error("new pairing requested"));
  }
  runtime.socket = null;
  runtime.qrDataUrl = null;
  runtime.backfillCompleted = false;
  if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
  await rm(authDir(organizationId), { recursive: true, force: true });
  runtime.manualStop = false;
  await startBaileys(organizationId);
}

/** Recupera sessões que estavam ativas antes do processo Node reiniciar. */
export async function recoverBaileysConnections(): Promise<void> {
  // Migra inclusive sessões antigas/inativas para não manter chaves em texto puro.
  const directories = await readdir(authRoot(), { withFileTypes: true }).catch(() => []);
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    await loadEncryptedAuthState(path.join(authRoot(), directory.name)).catch((error: unknown) => {
      console.warn(`[baileys] sessão antiga não migrada: ${error instanceof Error ? error.message : "erro"}`);
    });
  }
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

type QuotedSend = {
  localId: string;
  providerId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  senderJid: string | null;
  quoted: import("@whiskeysockets/baileys").WAMessage;
};

export function buildBaileysQuotedMessage(
  message: { providerId: string; direction: "in" | "out"; type: string; text: string | null; senderJid: string | null },
  remoteJid: string,
  currentUserJid?: string
): { quoted: import("@whiskeysockets/baileys").WAMessage; participant: string | null } {
  const participant = message.senderJid ?? (message.direction === "out" ? currentUserJid ?? null : null);
  if (remoteJid.endsWith("@g.us") && !participant) {
    throw new Error("Não foi possível identificar o participante da mensagem citada");
  }
  const text = message.text ?? (message.type === "text" ? "Mensagem" : `[${message.type}]`);
  const quotedMessage: import("@whiskeysockets/baileys").proto.IMessage = message.type === "image"
    ? { imageMessage: { caption: text } }
    : message.type === "video"
      ? { videoMessage: { caption: text } }
      : message.type === "audio"
        ? { audioMessage: {} }
        : message.type === "document"
          ? { documentMessage: { caption: text } }
          : message.type === "sticker"
            ? { stickerMessage: {} }
            : { conversation: text };
  return {
    participant,
    quoted: {
      key: {
        remoteJid,
        id: message.providerId,
        fromMe: message.direction === "out",
        participant: remoteJid.endsWith("@g.us") ? participant ?? undefined : undefined,
      },
      message: quotedMessage,
    },
  };
}

async function quotedForSend(organizationId: string, chatId: string, remoteJid: string, localId?: string, currentUserJid?: string): Promise<QuotedSend | null> {
  if (!localId) return null;
  const [message] = await getDb().select({
    id: schema.baileysMessage.id,
    providerId: schema.baileysMessage.providerId,
    direction: schema.baileysMessage.direction,
    type: schema.baileysMessage.type,
    text: schema.baileysMessage.text,
    senderJid: schema.baileysMessage.senderJid,
  }).from(schema.baileysMessage).where(and(
    eq(schema.baileysMessage.id, localId),
    eq(schema.baileysMessage.organizationId, organizationId),
    eq(schema.baileysMessage.chatId, chatId),
    notLike(schema.baileysMessage.providerId, "failed:%")
  )).limit(1);
  if (!message) throw new Error("Mensagem citada não pertence a esta conversa");
  const built = buildBaileysQuotedMessage(message, remoteJid, currentUserJid);
  return {
    localId: message.id,
    providerId: message.providerId,
    direction: message.direction,
    type: message.type,
    text: message.text,
    senderJid: built.participant,
    quoted: built.quoted,
  };
}

export async function sendText(organizationId: string, chatId: string, text: string, replyToMessageId?: string) {
  const runtime = runtimeFor(organizationId);
  if (!runtime.socket) throw new Error("Baileys não está conectado");
  const db = getDb();
  const [chat] = await db
    .select()
    .from(schema.baileysChat)
    .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chatId)))
    .limit(1);
  if (!chat) throw new Error("Conversa não encontrada");
  const reply = await quotedForSend(organizationId, chat.id, chat.remoteJid, replyToMessageId, runtime.socket.user?.id);
  let sent: Awaited<ReturnType<typeof runtime.socket.sendMessage>>;
  try {
    sent = await runtime.socket.sendMessage(chat.remoteJid, { text }, reply ? { quoted: reply.quoted } : undefined);
    if (!sent) throw new Error("O WhatsApp não confirmou o envio");
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
      replyToProviderId: reply?.providerId ?? null,
      replyToType: reply?.type ?? null,
      replyToText: reply?.text?.slice(0, 200) ?? null,
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

  // O WhatsApp já confirmou o envio. Uma falha local não pode virar "falha de
  // envio" nem induzir o operador a reenviar a mesma mensagem remotamente.
  await retryBaileysPersistence(() => persistMessage(organizationId, sent!, runtime.socket!))
    .catch((error: unknown) => {
      const providerId = sent?.key.id ?? "sem-id";
      const reason = error instanceof Error ? error.message.slice(0, 160) : "erro desconhecido";
      console.error(`[baileys] mensagem enviada, mas não persistida org=${organizationId} id=${providerId}: ${reason}`);
    });
}

type BaileysOutgoingFile = {
  data: Buffer;
  mimeType: string;
  fileName?: string;
  caption?: string;
  voice?: boolean;
  replyToMessageId?: string;
};

export function baileysMediaContent(
  kind: "image" | "video" | "audio" | "document",
  file: { data: Buffer; mimeType: string; fileName?: string },
  caption?: string,
  voice = false
): import("@whiskeysockets/baileys").AnyMessageContent {
  if (kind === "image") return { image: file.data, mimetype: file.mimeType, caption };
  if (kind === "video") return { video: file.data, mimetype: file.mimeType, caption };
  if (kind === "audio") return { audio: file.data, mimetype: file.mimeType, ptt: voice };
  return { document: file.data, mimetype: file.mimeType, fileName: file.fileName ?? "documento", caption };
}

/** Envia somente os tipos de mídia comprovadamente aceitos pelo socket atual. */
export async function sendBaileysMedia(
  organizationId: string,
  chatId: string,
  input: BaileysOutgoingFile
): Promise<void> {
  const runtime = runtimeFor(organizationId);
  if (!runtime.socket) throw new Error("Baileys não está conectado");
  const db = getDb();
  const [chat] = await db.select().from(schema.baileysChat).where(and(
    eq(schema.baileysChat.organizationId, organizationId),
    eq(schema.baileysChat.id, chatId)
  )).limit(1);
  if (!chat) throw new Error("Conversa não encontrada");
  const reply = await quotedForSend(organizationId, chat.id, chat.remoteJid, input.replyToMessageId, runtime.socket.user?.id);

  if (input.mimeType.startsWith("audio/") && input.data.byteLength > MEDIA_LIMITS.audio.maxBytes) {
    throw new MediaValidationError("too_large", `O áudio excede o limite de ${MEDIA_LIMITS.audio.maxBytes / 1024 / 1024} MB`);
  }

  const prepared = input.mimeType.startsWith("audio/")
    ? prepararAudioSaliente({ data: input.data, mimeType: input.mimeType, fileName: input.fileName }, input.voice === true)
    : { file: { data: input.data, mimeType: input.mimeType, fileName: input.fileName }, voice: false };
  const file = prepared.file;
  const kind = validateOutgoing(file.mimeType, file.data.byteLength);
  const assetId = newId("mediaAsset");
  const storagePath = await saveMediaFile(organizationId, assetId, file.data, file.mimeType);
  try {
    await db.insert(schema.mediaAsset).values({
      id: assetId,
      organizationId,
      kind,
      mimeType: file.mimeType,
      fileName: file.fileName ?? null,
      fileSize: file.data.byteLength,
      caption: input.caption ?? null,
      storagePath,
      fetchStatus: "available",
    });
  } catch (error) {
    await deleteMediaFile(organizationId, assetId).catch(() => undefined);
    throw error;
  }

  const content = baileysMediaContent(kind, file, input.caption, prepared.voice);

  let sent: Awaited<ReturnType<typeof runtime.socket.sendMessage>>;
  try {
    sent = await runtime.socket.sendMessage(chat.remoteJid, content, reply ? { quoted: reply.quoted } : undefined);
    if (!sent?.key.id) throw new Error("O WhatsApp não confirmou o envio da mídia");
  } catch (error) {
    const messageId = newId("baileysMessage");
    const reason = error instanceof Error ? error.message.slice(0, 240) : "Falha no envio da mídia";
    await db.insert(schema.baileysMessage).values({
      id: messageId,
      organizationId,
      chatId: chat.id,
      providerId: `failed:${messageId}`,
      direction: "out",
      type: kind,
      text: input.caption ?? null,
      replyToProviderId: reply?.providerId ?? null,
      replyToType: reply?.type ?? null,
      replyToText: reply?.text?.slice(0, 200) ?? null,
      mediaAssetId: assetId,
      status: "failed",
      error: reason,
      occurredAt: new Date(),
    });
    publish(organizationId, { type: "baileys.updated", data: { chatId: chat.id, messageId } });
    throw error;
  }

  const occurredAt = sent.messageTimestamp
    ? new Date(Number(sent.messageTimestamp) * 1000)
    : new Date();
  await retryBaileysPersistence(async () => {
    const [stored] = await db.insert(schema.baileysMessage).values({
      id: newId("baileysMessage"),
      organizationId,
      chatId: chat.id,
      providerId: sent!.key.id!,
      direction: "out",
      type: kind,
      text: input.caption ?? null,
      replyToProviderId: reply?.providerId ?? null,
      replyToType: reply?.type ?? null,
      replyToText: reply?.text?.slice(0, 200) ?? null,
      mediaAssetId: assetId,
      status: "sent",
      occurredAt,
    }).onConflictDoNothing().returning({ id: schema.baileysMessage.id });
    if (!stored) {
      await db.update(schema.baileysMessage).set({ mediaAssetId: assetId }).where(and(
        eq(schema.baileysMessage.organizationId, organizationId),
        eq(schema.baileysMessage.providerId, sent!.key.id!),
        isNull(schema.baileysMessage.mediaAssetId)
      ));
    }
    await db.update(schema.baileysChat).set({
      lastMessage: input.caption ?? `[${kind}]`,
      lastMessageAt: occurredAt,
      updatedAt: new Date(),
    }).where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chat.id)));
  }).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message.slice(0, 160) : "erro desconhecido";
    console.error(`[baileys] mídia enviada, mas não persistida org=${organizationId}: ${reason}`);
  });
  publish(organizationId, { type: "baileys.updated", data: { chatId: chat.id } });
}

export async function markBaileysChatRead(organizationId: string, chatId: string): Promise<void> {
  const db = getDb();
  const [chat] = await db
    .select({ id: schema.baileysChat.id, remoteJid: schema.baileysChat.remoteJid })
    .from(schema.baileysChat)
    .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chatId)))
    .limit(1);
  if (!chat) throw new Error("Conversa não encontrada");
  const runtime = runtimeFor(organizationId);
  if (runtime.socket) {
    const unread = await db
      .select({ providerId: schema.baileysMessage.providerId })
      .from(schema.baileysMessage)
      .where(and(
        eq(schema.baileysMessage.organizationId, organizationId),
        eq(schema.baileysMessage.chatId, chatId),
        eq(schema.baileysMessage.direction, "in")
      ))
      .orderBy(desc(schema.baileysMessage.occurredAt))
      .limit(100);
    if (unread.length) {
      await runtime.socket.readMessages(unread.map(({ providerId }) => ({
        remoteJid: chat.remoteJid,
        id: providerId,
        fromMe: false,
      })));
    }
  }
  await db.update(schema.baileysChat)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.id, chatId)));
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

export async function updateBaileysContact(
  organizationId: string,
  chatId: string,
  input: { name: string; phone: string | null }
): Promise<void> {
  const [updated] = await getDb().update(schema.baileysChat).set({
    name: input.name.trim(),
    phone: input.phone,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.baileysChat.organizationId, organizationId),
    eq(schema.baileysChat.id, chatId),
    eq(schema.baileysChat.isGroup, false)
  )).returning({ id: schema.baileysChat.id });
  if (!updated) throw new Error("Contato não encontrado");
  publish(organizationId, { type: "baileys.updated", data: { chatId } });
}

export type BaileysPageCursor = { t: string; id: string };

export function encodeBaileysCursor(cursor: BaileysPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeBaileysCursor(raw?: string | null): BaileysPageCursor | null {
  if (!raw) return null;
  if (raw.length > 512) throw new Error("cursor_invalid");
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<BaileysPageCursor>;
    if (typeof parsed.t !== "string" || !Number.isFinite(Date.parse(parsed.t)) || typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 100) throw new Error();
    return { t: parsed.t, id: parsed.id };
  } catch {
    throw new Error("cursor_invalid");
  }
}

export async function baileysSnapshot(
  organizationId: string,
  chatId?: string | null,
  pagination: { chatCursor?: string | null; messageCursor?: string | null; aroundMessageId?: string | null } = {}
) {
  const db = getDb();
  const chatCursor = decodeBaileysCursor(pagination.chatCursor);
  const messageCursor = decodeBaileysCursor(pagination.messageCursor);
  if (pagination.aroundMessageId && (pagination.aroundMessageId.length > 100 || pagination.messageCursor)) throw new Error("message_invalid");
  const [connection] = await db
    .select()
    .from(schema.baileysConnection)
    .where(eq(schema.baileysConnection.organizationId, organizationId))
    .limit(1);
  // Atualizações de foto/nome não mudam a posição da conversa. Chats sem
  // atividade conhecida ficam no fim, como no WhatsApp.
  const chatActivity = sql<Date>`coalesce(${schema.baileysChat.lastMessageAt}, timestamp '1970-01-01')`;
  const chatRows = await db
    .select()
    .from(schema.baileysChat)
    .where(and(
      eq(schema.baileysChat.organizationId, organizationId),
      eq(schema.baileysChat.isGroup, false),
      notLike(schema.baileysChat.remoteJid, "%@newsletter"),
      chatCursor ? sql`(${chatActivity}, ${schema.baileysChat.id}) < (${new Date(chatCursor.t)}, ${chatCursor.id})` : undefined
    ))
    .orderBy(desc(chatActivity), desc(schema.baileysChat.id))
    .limit(51);
  const hasMoreChats = chatRows.length > 50;
  const chats = chatRows.slice(0, 50);
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const aroundMessage = chatId && pagination.aroundMessageId
    ? (await db.select({ id: schema.baileysMessage.id, occurredAt: schema.baileysMessage.occurredAt })
        .from(schema.baileysMessage).where(and(
          eq(schema.baileysMessage.organizationId, organizationId),
          eq(schema.baileysMessage.chatId, chatId),
          eq(schema.baileysMessage.id, pagination.aroundMessageId),
        )).limit(1))[0]
    : null;
  if (pagination.aroundMessageId && !aroundMessage) throw new Error("message_invalid");
  const olderMessages = chatId
    ? await db
        .select()
        .from(schema.baileysMessage)
        .where(and(
          eq(schema.baileysMessage.organizationId, organizationId),
          eq(schema.baileysMessage.chatId, chatId),
          messageCursor ? sql`(${schema.baileysMessage.occurredAt}, ${schema.baileysMessage.id}) < (${new Date(messageCursor.t)}, ${messageCursor.id})` : undefined,
          aroundMessage ? sql`(${schema.baileysMessage.occurredAt}, ${schema.baileysMessage.id}) <= (${aroundMessage.occurredAt}, ${aroundMessage.id})` : undefined,
        ))
        .orderBy(desc(schema.baileysMessage.occurredAt), desc(schema.baileysMessage.id))
        .limit(aroundMessage ? 51 : 101)
    : [];
  const newerMessages = chatId && aroundMessage
    ? await db.select().from(schema.baileysMessage).where(and(
        eq(schema.baileysMessage.organizationId, organizationId),
        eq(schema.baileysMessage.chatId, chatId),
        sql`(${schema.baileysMessage.occurredAt}, ${schema.baileysMessage.id}) > (${aroundMessage.occurredAt}, ${aroundMessage.id})`,
      )).orderBy(asc(schema.baileysMessage.occurredAt), asc(schema.baileysMessage.id)).limit(50)
    : [];
  const recentMessages = aroundMessage ? [...newerMessages.reverse(), ...olderMessages] : olderMessages;
  // A janela limitada precisa conter as mensagens mais recentes; a UI recebe
  // essa janela novamente em ordem cronológica.
  const hasMoreMessages = aroundMessage ? olderMessages.length > 50 : recentMessages.length > 100;
  const messagePage = aroundMessage ? recentMessages.slice(0, 100) : recentMessages.slice(0, 100);
  const oldestMessage = messagePage.at(-1);
  const messages = messagePage.reverse();
  const assetIds = messages.flatMap((message) => message.mediaAssetId ? [message.mediaAssetId] : []);
  const assets = assetIds.length
    ? await db.select().from(schema.mediaAsset).where(and(
        eq(schema.mediaAsset.organizationId, organizationId),
        inArray(schema.mediaAsset.id, assetIds)
      ))
    : [];
  const repliedProviderIds = [...new Set(messages.flatMap((message) => message.replyToProviderId ? [message.replyToProviderId] : []))];
  const repliedMessages = chatId && repliedProviderIds.length
    ? await db.select({
        id: schema.baileysMessage.id,
        providerId: schema.baileysMessage.providerId,
        direction: schema.baileysMessage.direction,
        type: schema.baileysMessage.type,
        text: schema.baileysMessage.text,
        mediaAssetId: schema.baileysMessage.mediaAssetId,
      }).from(schema.baileysMessage).where(and(
        eq(schema.baileysMessage.organizationId, organizationId),
        eq(schema.baileysMessage.chatId, chatId),
        inArray(schema.baileysMessage.providerId, repliedProviderIds)
      ))
    : [];
  const repliedByProvider = new Map(repliedMessages.map((message) => [message.providerId, message]));
  const selectedChat = chatId
    ? chats.find((chat) => chat.id === chatId) ?? (await db.select().from(schema.baileysChat).where(and(
        eq(schema.baileysChat.organizationId, organizationId),
        eq(schema.baileysChat.isGroup, false),
        eq(schema.baileysChat.id, chatId)
      )).limit(1))[0] ?? null
    : null;
  const [selectedStats] = selectedChat
    ? await db.select({
        messageCount: sql<number>`count(*)::int`,
        firstMessageAt: sql<Date | null>`min(${schema.baileysMessage.occurredAt})`,
        lastMessageAt: sql<Date | null>`max(${schema.baileysMessage.occurredAt})`,
      }).from(schema.baileysMessage).where(and(
        eq(schema.baileysMessage.organizationId, organizationId),
        eq(schema.baileysMessage.chatId, selectedChat.id)
      ))
    : [];
  const rawParticipants = selectedChat?.isGroup && Array.isArray(selectedChat.participants)
    ? selectedChat.participants as Array<{ jid?: unknown; admin?: unknown }>
    : [];
  const participantJids = rawParticipants.flatMap((participant) => typeof participant.jid === "string" ? [participant.jid] : []);
  const knownParticipants = participantJids.length
    ? await db.select().from(schema.baileysChat).where(and(
        eq(schema.baileysChat.organizationId, organizationId),
        inArray(schema.baileysChat.remoteJid, participantJids)
      ))
    : [];
  const chatByJid = new Map([...chats, ...knownParticipants].map((chat) => [chat.remoteJid, chat]));
  const selectedDetails = selectedChat ? {
    messageCount: selectedStats?.messageCount ?? 0,
    firstMessageAt: selectedStats?.firstMessageAt ?? null,
    lastMessageAt: selectedStats?.lastMessageAt ?? null,
    participants: rawParticipants.flatMap((participant) => {
      if (typeof participant.jid !== "string") return [];
      const known = chatByJid.get(participant.jid);
      const phone = known?.phone
        ?? (participant.jid.endsWith("@s.whatsapp.net") ? participant.jid.split("@")[0] ?? null : null);
      const admin = participant.admin === "admin" || participant.admin === "superadmin"
        ? participant.admin
        : null;
      return [{ jid: participant.jid, name: known?.name ?? null, phone, admin }];
    }),
  } : null;
  const responseChats = selectedChat && !chats.some((chat) => chat.id === selectedChat.id)
    ? [...chats, selectedChat]
    : chats;
  return {
    connection: connection ?? { status: "disconnected", phone: null, error: null },
    qr: runtimeFor(organizationId).qrDataUrl,
    syncing: runtimeFor(organizationId).syncing,
    syncProgress: runtimeFor(organizationId).syncProgress,
    syncError: runtimeFor(organizationId).syncError,
    diagnostics: {
      lastUpsertAt: runtimeFor(organizationId).lastUpsertAt,
      lastUpsertType: runtimeFor(organizationId).lastUpsertType,
    },
    chats: responseChats.map((chat) => ({
      ...chat,
      stageName: stages.find((stage) => stage.id === chat.stageId)?.name ?? null,
    })),
    stages,
    pagination: {
      chatsNextCursor: hasMoreChats && chats.length ? encodeBaileysCursor({
        t: (chats.at(-1)!.lastMessageAt ?? new Date(0)).toISOString(),
        id: chats.at(-1)!.id,
      }) : null,
      messagesNextCursor: hasMoreMessages && oldestMessage ? encodeBaileysCursor({
        t: oldestMessage.occurredAt.toISOString(),
        id: oldestMessage.id,
      }) : null,
    },
    selectedDetails,
    messages: messages.map((message) => ({
      ...message,
      media: assets.find((asset) => asset.id === message.mediaAssetId) ?? null,
      replyTo: message.replyToProviderId ? (() => {
        const original = repliedByProvider.get(message.replyToProviderId);
        const type = original?.type ?? message.replyToType;
        return {
          id: original?.id ?? null,
          direction: original?.direction ?? null,
          type: type ?? null,
          text: original?.text ?? message.replyToText,
          mediaKind: type && type !== "text" ? type : null,
        };
      })() : null,
    })),
  };
}
