import { and, asc, eq, isNotNull } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/** Datos completos del kanban: etapas ordenadas + tarjetas con su contacto. */
export const GET = withAuth(async (session, request: Request) => {
  const db = getDb();
  const modo = new URL(request.url).searchParams.get("modo") === "baileys" ? "baileys" : "api";

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const leads = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversationId: schema.conversation.id,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .where(scoped(schema.lead.organizationId, session.organizationId))
    .orderBy(asc(schema.lead.position));

  const baileysChats = await db
    .select()
    .from(schema.baileysChat)
    .where(and(
      scoped(schema.baileysChat.organizationId, session.organizationId),
      isNotNull(schema.baileysChat.stageId)
    ));

  // La moneda del negocio viaja con el tablero: el cliente suma sus columnas y
  // necesita saber cuál es la única sumable, sin adivinarla ni pedirla aparte.
  const { currency } = await getBranding(session.organizationId);

  return Response.json({
    currency,
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
    })),
    leads: modo === "api" ? leads.map((r) => ({
      id: r.lead.id,
      source: "meta" as const,
      stageId: r.lead.stageId,
      position: r.lead.position,
      lastActivityAt: r.lead.lastActivityAt?.toISOString() ?? null,
      amountCents: r.lead.amountCents,
      currency: r.lead.currency,
      priority: r.lead.priority,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
      },
      conversationId: r.conversationId,
    })) : baileysChats.map((chat, position) => ({
      id: chat.id,
      source: "baileys" as const,
      stageId: chat.stageId!,
      position,
      lastActivityAt: chat.lastMessageAt?.toISOString() ?? null,
      amountCents: null,
      currency: null,
      priority: null,
      contact: {
        id: chat.id,
        name: chat.name || chat.phone || "Conversa Baileys",
        phone: chat.phone,
      },
      conversationId: chat.id,
    })),
  });
});
