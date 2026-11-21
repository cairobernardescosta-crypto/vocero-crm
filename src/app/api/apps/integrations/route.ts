import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

const providerSchema = z.enum(["brevo", "mailchimp", "meta", "tiktok"]);
const saveSchema = z.object({ provider: providerSchema, accountId: z.string().trim().max(200).nullable(), secret: z.string().min(1).max(2000) });

export const GET = withAuth(async (session) => {
  const rows = await getDb().select({
    provider: schema.appIntegration.provider, accountId: schema.appIntegration.accountId,
    enabled: schema.appIntegration.enabled, status: schema.appIntegration.status,
    lastSyncAt: schema.appIntegration.lastSyncAt, updatedAt: schema.appIntegration.updatedAt,
  }).from(schema.appIntegration).where(eq(schema.appIntegration.organizationId, session.organizationId));
  return Response.json({ integrations: rows });
});
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, saveSchema); if (!body.ok) return body.response;
  const encrypted = encryptSecret(body.data.secret);
  const [integration] = await getDb().insert(schema.appIntegration).values({
    id: newId("appIntegration"), organizationId: session.organizationId, provider: body.data.provider,
    accountId: body.data.accountId, credentials: encrypted, enabled: false, status: "configured_not_tested", updatedAt: new Date(),
  }).onConflictDoUpdate({ target: [schema.appIntegration.organizationId, schema.appIntegration.provider], set: {
    accountId: body.data.accountId, credentials: encrypted, enabled: false, status: "configured_not_tested", updatedAt: new Date(),
  } }).returning({ provider: schema.appIntegration.provider, accountId: schema.appIntegration.accountId, enabled: schema.appIntegration.enabled, status: schema.appIntegration.status });
  return Response.json({ integration });
});
export const DELETE = withAuth(async (session, req: Request) => {
  const provider = new URL(req.url).searchParams.get("provider");
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success) return apiError(422, "invalid_provider", "Provedor inválido");
  await getDb().delete(schema.appIntegration).where(and(eq(schema.appIntegration.organizationId, session.organizationId), eq(schema.appIntegration.provider, parsed.data)));
  return Response.json({ ok: true });
});
