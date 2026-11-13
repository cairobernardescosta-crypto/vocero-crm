import { asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { baileysDisabledResponse, baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  const chats = await getDb()
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
    .where(eq(schema.baileysChat.organizationId, session.organizationId))
    .orderBy(asc(schema.baileysChat.name));
  return Response.json({
    contacts: chats,
  });
});
