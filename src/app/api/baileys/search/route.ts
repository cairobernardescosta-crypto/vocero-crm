import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { baileysDisabledResponse, baileysEnabled } from "@/server/baileys/flag";
import { searchBaileysMessages } from "@/server/baileys/search";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  cursor: z.string().max(512).nullable(),
});

export const GET = withAuth(async (session, req: Request) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  const params = new URL(req.url).searchParams;
  const parsed = querySchema.safeParse({ q: params.get("q") ?? "", cursor: params.get("cursor") });
  if (!parsed.success) return apiError(422, "invalid", "A busca deve ter entre 2 e 100 caracteres");
  try {
    return Response.json(await searchBaileysMessages(session.organizationId, parsed.data.q, parsed.data.cursor));
  } catch (error) {
    if (error instanceof Error && error.message === "cursor_invalid") return apiError(400, "invalid_cursor", "Cursor de busca inválido");
    throw error;
  }
});
