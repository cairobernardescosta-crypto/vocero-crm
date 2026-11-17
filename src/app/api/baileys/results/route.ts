import { and, count, eq, like, notLike, sum } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { baileysDisabledResponse, baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  const db = getDb();
  const org = session.organizationId;
  const [[chats], [groups], [incoming], [outgoing]] = await Promise.all([
    db.select({ total: count(), unread: sum(schema.baileysChat.unreadCount) }).from(schema.baileysChat).where(and(eq(schema.baileysChat.organizationId, org), eq(schema.baileysChat.isGroup, false), notLike(schema.baileysChat.remoteJid, "%@newsletter"))),
    db.select({ total: count() }).from(schema.baileysChat).where(and(eq(schema.baileysChat.organizationId, org), like(schema.baileysChat.remoteJid, "%@g.us"))),
    db.select({ total: count() }).from(schema.baileysMessage).where(and(eq(schema.baileysMessage.organizationId, org), eq(schema.baileysMessage.direction, "in"))),
    db.select({ total: count() }).from(schema.baileysMessage).where(and(eq(schema.baileysMessage.organizationId, org), eq(schema.baileysMessage.direction, "out"))),
  ]);
  return Response.json({
    conversations: chats?.total ?? 0,
    unread: Number(chats?.unread ?? 0),
    groups: groups?.total ?? 0,
    incoming: incoming?.total ?? 0,
    outgoing: outgoing?.total ?? 0,
  });
});
