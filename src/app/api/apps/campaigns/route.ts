import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120), platform: z.enum(["meta", "tiktok", "email", "other"]),
  startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(),
  investmentCents: z.number().int().nonnegative().nullable().optional(), reach: z.number().int().nonnegative().nullable().optional(),
  impressions: z.number().int().nonnegative().nullable().optional(), clicks: z.number().int().nonnegative().nullable().optional(),
  leads: z.number().int().nonnegative().nullable().optional(), conversions: z.number().int().nonnegative().nullable().optional(),
  revenueCents: z.number().int().nonnegative().nullable().optional(),
});

export const GET = withAuth(async (session) => Response.json({
  campaigns: await getDb().select().from(schema.campaignResult)
    .where(eq(schema.campaignResult.organizationId, session.organizationId))
    .orderBy(desc(schema.campaignResult.startsAt), desc(schema.campaignResult.createdAt)),
}));

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, campaignSchema);
  if (!body.ok) return body.response;
  const [campaign] = await getDb().insert(schema.campaignResult).values({
    id: newId("campaignResult"), organizationId: session.organizationId, ...body.data,
    startsAt: body.data.startsAt ? new Date(body.data.startsAt) : null,
    endsAt: body.data.endsAt ? new Date(body.data.endsAt) : null,
  }).returning();
  return Response.json({ campaign }, { status: 201 });
});
