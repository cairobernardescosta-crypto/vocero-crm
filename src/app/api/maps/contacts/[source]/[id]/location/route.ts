import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sourceContactExists, type ContactSource } from "@/server/maps-apps/contacts";

type Params = { params: Promise<{ source: string; id: string }> };
const bodySchema = z.object({ address: z.string().trim().max(300).nullable(), city: z.string().trim().max(100).nullable(), neighborhood: z.string().trim().max(100).nullable(), latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable() });

export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const { source: rawSource, id } = await ctx.params;
  if (rawSource !== "api" && rawSource !== "baileys") return apiError(422, "invalid_source", "Fonte inválida");
  const source = rawSource as ContactSource; const body = await parseBody(req, bodySchema); if (!body.ok) return body.response;
  if (!(await sourceContactExists(session.organizationId, source, id))) return apiError(404, "not_found", "Contato não encontrado");
  const located = body.data.latitude != null && body.data.longitude != null;
  const [location] = await getDb().insert(schema.mapContactGeo).values({ id: newId("mapContactGeo"), organizationId: session.organizationId, source, sourceId: id, ...body.data, status: located ? "located" : "pending", provider: "manual", manual: true, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.mapContactGeo.organizationId, schema.mapContactGeo.source, schema.mapContactGeo.sourceId], set: { ...body.data, status: located ? "located" : "pending", provider: "manual", manual: true, updatedAt: new Date() } }).returning();
  return Response.json({ location });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { source, id } = await ctx.params;
  if (source !== "api" && source !== "baileys") return apiError(422, "invalid_source", "Fonte inválida");
  await getDb().delete(schema.mapContactGeo).where(and(eq(schema.mapContactGeo.organizationId, session.organizationId), eq(schema.mapContactGeo.source, source), eq(schema.mapContactGeo.sourceId, id)));
  return Response.json({ ok: true });
});
