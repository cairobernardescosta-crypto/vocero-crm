import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

const PAGE_SIZE = 30;

type SearchCursor = { q: string; t: string; id: string };

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

function decodeCursor(raw: string | null, query: string): SearchCursor | null {
  if (!raw) return null;
  if (raw.length > 512) throw new Error("cursor_invalid");
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<SearchCursor>;
    if (parsed.q !== query || typeof parsed.t !== "string" || !Number.isFinite(Date.parse(parsed.t)) || typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 100) throw new Error();
    return { q: parsed.q, t: parsed.t, id: parsed.id };
  } catch {
    throw new Error("cursor_invalid");
  }
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function searchBaileysMessages(organizationId: string, rawQuery: string, rawCursor: string | null) {
  const query = normalizeQuery(rawQuery);
  const cursor = decodeCursor(rawCursor, query);
  const db = getDb();
  const rows = await db.select({
    messageId: schema.baileysMessage.id,
    chatId: schema.baileysMessage.chatId,
    chatName: schema.baileysChat.name,
    chatPhone: schema.baileysChat.phone,
    avatarUrl: schema.baileysChat.avatarUrl,
    text: schema.baileysMessage.text,
    direction: schema.baileysMessage.direction,
    occurredAt: schema.baileysMessage.occurredAt,
  }).from(schema.baileysMessage).innerJoin(
    schema.baileysChat,
    and(
      eq(schema.baileysChat.id, schema.baileysMessage.chatId),
      eq(schema.baileysChat.organizationId, organizationId),
      eq(schema.baileysChat.isGroup, false),
    ),
  ).where(and(
    eq(schema.baileysMessage.organizationId, organizationId),
    isNotNull(schema.baileysMessage.text),
    sql`to_tsvector('simple', coalesce(${schema.baileysMessage.text}, '')) @@ plainto_tsquery('simple', ${query})`,
    cursor ? sql`(${schema.baileysMessage.occurredAt}, ${schema.baileysMessage.id}) < (${new Date(cursor.t)}, ${cursor.id})` : undefined,
  )).orderBy(desc(schema.baileysMessage.occurredAt), desc(schema.baileysMessage.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    results: page.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ q: query, t: last.occurredAt.toISOString(), id: last.messageId }) : null,
  };
}
