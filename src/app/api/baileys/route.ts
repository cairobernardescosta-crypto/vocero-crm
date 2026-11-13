import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { baileysDisabledResponse, baileysEnabled } from "@/server/baileys/flag";
import { baileysSnapshot, markBaileysChatRead, sendText, setBaileysChatStage, startBaileys, stopBaileys } from "@/server/baileys/connector";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("mark_read"), chatId: z.string().min(1).max(80) }),
  z.object({ action: z.literal("set_stage"), chatId: z.string().min(1).max(80), stageId: z.string().min(1).max(80) }),
  z.object({
    action: z.literal("send"),
    chatId: z.string().min(1).max(80),
    text: z.string().trim().min(1).max(4096),
  }),
]);

export const GET = withAuth(async (session, req: Request) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  const chatId = new URL(req.url).searchParams.get("chatId");
  return Response.json(await baileysSnapshot(session.organizationId, chatId));
});

export const POST = withAuth(async (session, req: Request) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  const body = await parseBody(req, actionSchema);
  if (!body.ok) return body.response;
  if ((body.data.action === "connect" || body.data.action === "disconnect") && !canConfigure(session.role)) {
    return apiError(403, "forbidden", "Sem permissão para administrar a conexão");
  }
  if (body.data.action === "connect") await startBaileys(session.organizationId);
  if (body.data.action === "disconnect") await stopBaileys(session.organizationId);
  if (body.data.action === "mark_read") {
    try {
      await markBaileysChatRead(session.organizationId, body.data.chatId);
    } catch (error) {
      return apiError(404, "chat_not_found", error instanceof Error ? error.message : "Conversa não encontrada");
    }
  }
  if (body.data.action === "set_stage") {
    try {
      await setBaileysChatStage(session.organizationId, body.data.chatId, body.data.stageId);
    } catch (error) {
      return apiError(404, "stage_or_chat_not_found", error instanceof Error ? error.message : "Etapa ou conversa não encontrada");
    }
  }
  if (body.data.action === "send") {
    try {
      await sendText(session.organizationId, body.data.chatId, body.data.text);
    } catch (error) {
      return apiError(409, "send_failed", error instanceof Error ? error.message : "Falha no envio");
    }
  }
  return Response.json({ ok: true });
});
