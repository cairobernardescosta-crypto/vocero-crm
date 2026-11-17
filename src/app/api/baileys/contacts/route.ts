import { and, asc, eq, ilike, notLike, or, sql } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { baileysDisabledResponse, baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

type Cursor = { k: string; id: string };

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  if (raw.length > 512) throw new Error("cursor_invalid");
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.k !== "string" || typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 100) throw new Error();
    return { k: parsed.k, id: parsed.id };
  } catch { throw new Error("cursor_invalid"); }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export const GET = withAuth(async (session, req: Request) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  const params = new URL(req.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  let cursor: Cursor | null;
  try { cursor = decodeCursor(params.get("cursor")); }
  catch { return apiError(400, "invalid_cursor", "Cursor de contatos inválido"); }
  const sortKey = sql<string>`coalesce(lower(${schema.baileysChat.name}), lower(${schema.baileysChat.phone}), lower(${schema.baileysChat.remoteJid}))`;
  const rows = await getDb()
    .select({
      id: schema.baileysChat.id,
      remoteJid: schema.baileysChat.remoteJid,
      name: schema.baileysChat.name,
      phone: schema.baileysChat.phone,
      isGroup: schema.baileysChat.isGroup,
      avatarUrl: schema.baileysChat.avatarUrl,
      participants: schema.baileysChat.participants,
      lastMessageAt: schema.baileysChat.lastMessageAt,
      unreadCount: schema.baileysChat.unreadCount,
    })
    .from(schema.baileysChat)
    .where(and(
      eq(schema.baileysChat.organizationId, session.organizationId),
      eq(schema.baileysChat.isGroup, false),
      notLike(schema.baileysChat.remoteJid, "%@newsletter"),
      query ? or(ilike(schema.baileysChat.name, `%${query}%`), ilike(schema.baileysChat.phone, `%${query}%`)) : undefined,
      cursor ? sql`(${sortKey}, ${schema.baileysChat.id}) > (${cursor.k}, ${cursor.id})` : undefined
    ))
    .orderBy(asc(sortKey), asc(schema.baileysChat.id))
    .limit(PAGE_SIZE + 1);
  const contacts = rows.slice(0, PAGE_SIZE);
  const last = contacts.at(-1);
  return Response.json({
    contacts,
    nextCursor: rows.length > PAGE_SIZE && last
      ? encodeCursor({ k: (last.name ?? last.phone ?? last.remoteJid).toLocaleLowerCase(), id: last.id })
      : null,
  });
});
