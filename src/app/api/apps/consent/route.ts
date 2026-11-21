import { z } from "zod";
import { parseBody, withAuth, apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sourceContactExists } from "@/server/maps-apps/contacts";

const consentSchema = z.object({ source: z.enum(["api", "baileys"]), sourceId: z.string().min(1).max(100), status: z.enum(["opt_in", "opt_out"]), legalBasis: z.string().trim().max(200).nullable() });
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, consentSchema); if (!body.ok) return body.response;
  if (!(await sourceContactExists(session.organizationId, body.data.source, body.data.sourceId))) return apiError(404, "not_found", "Contato não encontrado");
  const [consent] = await getDb().insert(schema.marketingConsent).values({ id: newId("marketingConsent"), organizationId: session.organizationId, ...body.data, recordedAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.marketingConsent.organizationId, schema.marketingConsent.source, schema.marketingConsent.sourceId], set: { status: body.data.status, legalBasis: body.data.legalBasis, recordedAt: new Date(), updatedAt: new Date() } }).returning();
  return Response.json({ consent });
});
