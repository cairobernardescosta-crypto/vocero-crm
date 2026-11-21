import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { buildContactsCsv, eligibleForFormat, EXPORT_COLUMNS, EXPORT_FORMATS } from "@/server/maps-apps/csv";
import { listNormalizedContacts } from "@/server/maps-apps/contacts";

const schemaBody = z.object({
  format: z.enum(EXPORT_FORMATS),
  columns: z.array(z.enum(EXPORT_COLUMNS)).min(1).max(EXPORT_COLUMNS.length),
  filters: z.object({
    q: z.string().max(100).optional(), source: z.enum(["api", "baileys"]).optional(),
    stageId: z.string().max(100).optional(), address: z.enum(["with", "without"]).optional(),
    email: z.enum(["with", "without"]).optional(), city: z.string().max(100).optional(),
    neighborhood: z.string().max(100).optional(),
  }).default({}),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, schemaBody);
  if (!body.ok) return body.response;
  const all = await listNormalizedContacts(session.organizationId, body.data.filters);
  const contacts = all.filter((contact) => eligibleForFormat(contact, body.data.format)).slice(0, 10_000);
  const csv = buildContactsCsv(contacts, body.data.columns);
  await getDb().insert(schema.appExportLog).values({
    id: newId("appExportLog"), organizationId: session.organizationId, format: body.data.format,
    rowCount: contacts.length, filters: body.data.filters, columns: body.data.columns,
  });
  const fileName = `vocero-${body.data.format}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${fileName}"`,
    "x-export-count": String(contacts.length),
  } });
});
