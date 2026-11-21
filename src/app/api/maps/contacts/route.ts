import { asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { listNormalizedContacts, type ContactSource, type MapContactFilters } from "@/server/maps-apps/contacts";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const p = new URL(req.url).searchParams;
  const source = p.get("source"); const address = p.get("address"); const email = p.get("email");
  const filters: MapContactFilters = {
    q: p.get("q")?.slice(0, 100), source: source === "api" || source === "baileys" ? source as ContactSource : undefined,
    stageId: p.get("stageId") || undefined, city: p.get("city")?.slice(0, 100), neighborhood: p.get("neighborhood")?.slice(0, 100),
    address: address === "with" || address === "without" ? address : undefined,
    email: email === "with" || email === "without" ? email : undefined,
  };
  const [contacts, stages] = await Promise.all([
    listNormalizedContacts(session.organizationId, filters),
    getDb().select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
      .from(schema.pipelineStage).where(eq(schema.pipelineStage.organizationId, session.organizationId)).orderBy(asc(schema.pipelineStage.position)),
  ]);
  const byStage: Record<string, number> = {}; const byNeighborhood: Record<string, number> = {};
  for (const contact of contacts) {
    const stage = contact.stageName ?? "Sem etapa"; byStage[stage] = (byStage[stage] ?? 0) + 1;
    const neighborhood = contact.neighborhood ?? "Não informado"; byNeighborhood[neighborhood] = (byNeighborhood[neighborhood] ?? 0) + 1;
  }
  return Response.json({ contacts, stages, stats: { total: contacts.length, located: contacts.filter((c) => c.latitude != null && c.longitude != null).length, withAddress: contacts.filter((c) => c.address).length, api: contacts.filter((c) => c.source === "api").length, baileys: contacts.filter((c) => c.source === "baileys").length, byStage, byNeighborhood } });
});
