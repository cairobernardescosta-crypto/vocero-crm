import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { EXPORT_FORMATS, eligibleForFormat } from "@/server/maps-apps/csv";
import { listNormalizedContacts, type ContactSource, type MapContactFilters } from "@/server/maps-apps/contacts";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const p = new URL(req.url).searchParams;
  const parsed = z.enum(EXPORT_FORMATS).safeParse(p.get("format") ?? "contacts");
  if (!parsed.success) return apiError(422, "invalid_format", "Formato inválido");
  const source = p.get("source");
  const filters: MapContactFilters = {
    q: p.get("q")?.slice(0, 100),
    source: source === "api" || source === "baileys" ? source as ContactSource : undefined,
    stageId: p.get("stageId") || undefined,
    address: p.get("address") === "with" || p.get("address") === "without" ? p.get("address") as "with" | "without" : undefined,
    email: p.get("email") === "with" || p.get("email") === "without" ? p.get("email") as "with" | "without" : undefined,
  };
  const all = await listNormalizedContacts(session.organizationId, filters);
  const contacts = all.filter((contact) => eligibleForFormat(contact, parsed.data));
  return Response.json({ total: contacts.length, excluded: all.length - contacts.length, contacts: contacts.slice(0, 25) });
});
