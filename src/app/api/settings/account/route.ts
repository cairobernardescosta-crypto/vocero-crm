import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(30).nullable(),
  image: z.string().url().max(1000).nullable(),
  password: z.string().max(128).nullable(),
});

export const GET = withAuth(async (session) => {
  const [user] = await getDb().select({ name: schema.user.name, email: schema.user.email, image: schema.user.image, phone: schema.user.phone })
    .from(schema.user).where(eq(schema.user.id, session.userId)).limit(1);
  if (!user) return apiError(404, "not_found", "Usuário não encontrado");
  return Response.json({ user, role: session.role });
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, updateSchema);
  if (!body.ok) return body.response;
  const passwordHash = body.data.password
    ? await hashPassword(body.data.password)
    : null;
  try {
    await getDb().transaction(async (tx) => {
      await tx.update(schema.user).set({
        name: body.data.name,
        email: body.data.email.toLowerCase(),
        phone: body.data.phone,
        image: body.data.image,
        updatedAt: new Date(),
      }).where(eq(schema.user.id, session.userId));
      if (passwordHash) {
        const credentials = await tx.update(schema.account).set({
          password: passwordHash,
          updatedAt: new Date(),
        }).where(and(eq(schema.account.userId, session.userId), eq(schema.account.providerId, "credential")))
          .returning({ id: schema.account.id });
        if (!credentials[0]) throw new Error("credential_not_found");
      }
    });
    return Response.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") return apiError(409, "email_in_use", "Este e-mail já está em uso");
    if (error instanceof Error && error.message === "credential_not_found") {
      return apiError(409, "credential_not_found", "Este usuário não possui senha local");
    }
    throw error;
  }
});
