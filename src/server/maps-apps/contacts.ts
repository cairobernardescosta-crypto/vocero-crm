import { and, asc, eq, notLike } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type ContactSource = "api" | "baileys";
export type MapContactFilters = {
  q?: string; source?: ContactSource; stageId?: string; city?: string; neighborhood?: string;
  address?: "with" | "without"; email?: "with" | "without";
};

export type NormalizedMapContact = {
  key: string; source: ContactSource; sourceId: string; name: string; phone: string | null;
  email: string | null; address: string | null; city: string | null; neighborhood: string | null;
  latitude: number | null; longitude: number | null; locationStatus: "pending" | "located" | "failed" | null;
  manualLocation: boolean; createdAt: string | null; lastInteractionAt: string | null;
  stageId: string | null; stageName: string | null; amountCents: number | null;
  lastPurchaseAt: string | null; lastPurchaseAmount: number | null; consent: "opt_in" | "opt_out" | null;
  contactHref: string; conversationHref: string | null;
};

function iso(value: Date | null | undefined): string | null { return value?.toISOString() ?? null; }

export async function listNormalizedContacts(organizationId: string, filters: MapContactFilters = {}): Promise<NormalizedMapContact[]> {
  const db = getDb();
  const [apiRows, baileysRows, geos, consents] = await Promise.all([
    db.select({
      id: schema.contact.id, name: schema.contact.name, phone: schema.contact.phone,
      createdAt: schema.contact.createdAt, conversationId: schema.conversation.id,
      lastInteractionAt: schema.conversation.lastMessageAt, stageId: schema.lead.stageId,
      stageName: schema.pipelineStage.name, amountCents: schema.lead.amountCents,
    }).from(schema.contact)
      .leftJoin(schema.conversation, and(eq(schema.conversation.organizationId, organizationId), eq(schema.conversation.contactId, schema.contact.id), eq(schema.conversation.isTest, false)))
      .leftJoin(schema.lead, and(eq(schema.lead.organizationId, organizationId), eq(schema.lead.contactId, schema.contact.id)))
      .leftJoin(schema.pipelineStage, and(eq(schema.pipelineStage.organizationId, organizationId), eq(schema.pipelineStage.id, schema.lead.stageId)))
      .where(eq(schema.contact.organizationId, organizationId)).orderBy(asc(schema.contact.name)),
    db.select({
      id: schema.baileysChat.id, name: schema.baileysChat.name, phone: schema.baileysChat.phone,
      email: schema.baileysChat.email, baseAddress: schema.baileysChat.address,
      lastInteractionAt: schema.baileysChat.lastMessageAt, stageId: schema.baileysChat.stageId,
      stageName: schema.pipelineStage.name, lastPurchaseAt: schema.baileysChat.lastPurchaseAt,
      lastPurchaseAmount: schema.baileysChat.lastPurchaseAmount,
    }).from(schema.baileysChat)
      .leftJoin(schema.pipelineStage, and(eq(schema.pipelineStage.organizationId, organizationId), eq(schema.pipelineStage.id, schema.baileysChat.stageId)))
      .where(and(eq(schema.baileysChat.organizationId, organizationId), eq(schema.baileysChat.isGroup, false), notLike(schema.baileysChat.remoteJid, "%@newsletter"))),
    db.select().from(schema.mapContactGeo).where(eq(schema.mapContactGeo.organizationId, organizationId)),
    db.select().from(schema.marketingConsent).where(eq(schema.marketingConsent.organizationId, organizationId)),
  ]);
  const geoMap = new Map(geos.map((g) => [`${g.source}:${g.sourceId}`, g]));
  const consentMap = new Map(consents.map((c) => [`${c.source}:${c.sourceId}`, c.status]));
  const contacts: NormalizedMapContact[] = [];
  const uniqueApiRows = new Map<string, (typeof apiRows)[number]>();
  for (const row of apiRows) {
    const current = uniqueApiRows.get(row.id);
    if (!current || (row.lastInteractionAt?.getTime() ?? 0) > (current.lastInteractionAt?.getTime() ?? 0)) {
      uniqueApiRows.set(row.id, row);
    }
  }
  for (const row of uniqueApiRows.values()) {
    const key = `api:${row.id}`; const geo = geoMap.get(key);
    contacts.push({ key, source: "api", sourceId: row.id, name: row.name, phone: row.phone, email: null,
      address: geo?.address ?? null, city: geo?.city ?? null, neighborhood: geo?.neighborhood ?? null,
      latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null, locationStatus: geo?.status ?? null,
      manualLocation: geo?.manual ?? false, createdAt: iso(row.createdAt), lastInteractionAt: iso(row.lastInteractionAt),
      stageId: row.stageId, stageName: row.stageName, amountCents: row.amountCents, lastPurchaseAt: null,
      lastPurchaseAmount: null, consent: consentMap.get(key) ?? null, contactHref: `/contacts?contact=${encodeURIComponent(row.id)}`,
      conversationHref: row.conversationId ? `/inbox?conversation=${encodeURIComponent(row.conversationId)}` : null });
  }
  for (const row of baileysRows) {
    const key = `baileys:${row.id}`; const geo = geoMap.get(key);
    contacts.push({ key, source: "baileys", sourceId: row.id, name: row.name || row.phone || "Contato",
      phone: row.phone, email: row.email, address: geo?.address ?? row.baseAddress, city: geo?.city ?? null,
      neighborhood: geo?.neighborhood ?? null, latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null,
      locationStatus: geo?.status ?? null, manualLocation: geo?.manual ?? false, createdAt: null,
      lastInteractionAt: iso(row.lastInteractionAt), stageId: row.stageId, stageName: row.stageName,
      amountCents: null, lastPurchaseAt: iso(row.lastPurchaseAt), lastPurchaseAmount: row.lastPurchaseAmount,
      consent: consentMap.get(key) ?? null, contactHref: `/baileys/inbox?chat=${encodeURIComponent(row.id)}`,
      conversationHref: `/baileys/inbox?chat=${encodeURIComponent(row.id)}` });
  }
  const q = filters.q?.trim().toLocaleLowerCase();
  return contacts.filter((c) => {
    if (filters.source && c.source !== filters.source) return false;
    if (filters.stageId && c.stageId !== filters.stageId) return false;
    if (filters.address === "with" && !c.address) return false;
    if (filters.address === "without" && c.address) return false;
    if (filters.email === "with" && !c.email) return false;
    if (filters.email === "without" && c.email) return false;
    if (filters.city && !c.city?.toLocaleLowerCase().includes(filters.city.toLocaleLowerCase())) return false;
    if (filters.neighborhood && !c.neighborhood?.toLocaleLowerCase().includes(filters.neighborhood.toLocaleLowerCase())) return false;
    if (q && ![c.name, c.phone, c.email, c.address, c.city, c.neighborhood].some((v) => v?.toLocaleLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function sourceContactExists(organizationId: string, source: ContactSource, sourceId: string): Promise<boolean> {
  const table = source === "api" ? schema.contact : schema.baileysChat;
  const [row] = await getDb().select({ id: table.id }).from(table).where(and(eq(table.organizationId, organizationId), eq(table.id, sourceId))).limit(1);
  return Boolean(row);
}
