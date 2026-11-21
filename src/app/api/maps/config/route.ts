import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

const configSchema = z.object({
  mapProvider: z.literal("openfreemap"), geocoder: z.enum(["manual", "nominatim"]),
  initialLatitude: z.number().min(-90).max(90), initialLongitude: z.number().min(-180).max(180),
  showPins: z.boolean(), showHeatmap: z.boolean(),
});
const defaults = { mapProvider: "openfreemap" as const, geocoder: "manual" as const, initialLatitude: -19.7276, initialLongitude: -50.2009, showPins: true, showHeatmap: false };

export const GET = withAuth(async (session) => {
  const [config] = await getDb().select().from(schema.mapSettings).where(eq(schema.mapSettings.organizationId, session.organizationId)).limit(1);
  return Response.json({ config: config ?? defaults, geocodingNotice: "A geocodificação automática permanece desativada até configuração explícita. O modo manual não envia dados externos." });
});
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, configSchema); if (!body.ok) return body.response;
  const [config] = await getDb().insert(schema.mapSettings).values({ id: newId("mapSettings"), organizationId: session.organizationId, ...body.data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.mapSettings.organizationId, set: { ...body.data, updatedAt: new Date() } }).returning();
  return Response.json({ config });
});
