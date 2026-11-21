import { and, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
type Params = { params: Promise<{ id: string }> };
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const rows = await getDb().delete(schema.campaignResult).where(and(
    eq(schema.campaignResult.organizationId, session.organizationId), eq(schema.campaignResult.id, id)
  )).returning({ id: schema.campaignResult.id });
  return rows[0] ? Response.json({ ok: true }) : apiError(404, "not_found", "Campanha não encontrada");
});
