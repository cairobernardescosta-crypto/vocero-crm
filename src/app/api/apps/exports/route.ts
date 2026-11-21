import { desc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

export const GET = withAuth(async (session) => Response.json({
  exports: await getDb().select().from(schema.appExportLog)
    .where(eq(schema.appExportLog.organizationId, session.organizationId))
    .orderBy(desc(schema.appExportLog.createdAt)).limit(50),
}));
