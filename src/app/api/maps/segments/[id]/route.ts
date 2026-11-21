import { and, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
type Params = { params: Promise<{ id: string }> };
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => { const { id } = await ctx.params; const rows = await getDb().delete(schema.mapSavedSegment).where(and(eq(schema.mapSavedSegment.organizationId, session.organizationId), eq(schema.mapSavedSegment.id, id))).returning({ id: schema.mapSavedSegment.id }); return rows[0] ? Response.json({ ok: true }) : apiError(404, "not_found", "Segmento não encontrado"); });
