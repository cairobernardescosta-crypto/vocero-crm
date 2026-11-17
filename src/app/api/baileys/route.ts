import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { baileysDisabledResponse, baileysEnabled } from "@/server/baileys/flag";
import { baileysSnapshot, markBaileysChatRead, pairBaileys, sendBaileysMedia, sendText, setBaileysChatStage, stopBaileys } from "@/server/baileys/connector";
import { MediaValidationError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

// Maior limite aceito (documento) + margem do envelope multipart. O navegador
// envia Content-Length; rejeitar antes de formData evita reservar >100 MB em RAM.
const MAX_MULTIPART_BYTES = 101 * 1024 * 1024;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("mark_read"), chatId: z.string().min(1).max(80) }),
  z.object({ action: z.literal("set_stage"), chatId: z.string().min(1).max(80), stageId: z.string().min(1).max(80) }),
  z.object({
    action: z.literal("send"),
    chatId: z.string().min(1).max(80),
    text: z.string().trim().min(1).max(4096),
    replyToMessageId: z.string().min(1).max(100).optional(),
  }),
]);

export const GET = withAuth(async (session, req: Request) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  const params = new URL(req.url).searchParams;
  const chatId = params.get("chatId");
  const aroundMessageId = params.get("aroundMessageId");
  if (chatId && chatId.length > 80) return apiError(422, "invalid", "Conversa inválida");
  if (aroundMessageId && (!chatId || aroundMessageId.length > 100)) return apiError(422, "invalid", "Mensagem inválida");
  try {
    return Response.json(await baileysSnapshot(session.organizationId, chatId, {
      chatCursor: params.get("chatCursor"),
      messageCursor: params.get("messageCursor"),
      aroundMessageId,
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "cursor_invalid") return apiError(400, "invalid_cursor", "Cursor de paginação inválido");
    if (error instanceof Error && error.message === "message_invalid") return apiError(404, "not_found", "Mensagem não encontrada nesta conversa");
    throw error;
  }
});

export const POST = withAuth(async (session, req: Request) => {
  if (!baileysEnabled()) return baileysDisabledResponse();
  if (req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    const contentLengthHeader = req.headers.get("content-length");
    const contentLength = Number(contentLengthHeader);
    // Request.formData() materializa o corpo inteiro. Exigir um tamanho válido
    // fecha o caminho chunked/sem limite antes de reservar memória.
    if (!contentLengthHeader || !Number.isSafeInteger(contentLength) || contentLength <= 0) {
      return apiError(411, "length_required", "O tamanho do upload é obrigatório");
    }
    if (contentLength > MAX_MULTIPART_BYTES) {
      return apiError(413, "too_large", "O arquivo excede o limite permitido");
    }
    const chatId = new URL(req.url).searchParams.get("chatId");
    if (!chatId || chatId.length > 80) return apiError(422, "invalid", "Conversa inválida");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return apiError(422, "invalid", "O arquivo está faltando (campo `file`)");
    if (file.size > 100 * 1024 * 1024) return apiError(413, "too_large", "O arquivo excede o limite permitido");
    const captionRaw = form?.get("caption");
    const caption = typeof captionRaw === "string" && captionRaw.trim()
      ? captionRaw.trim().slice(0, 1024)
      : undefined;
    const replyRaw = form?.get("replyToMessageId");
    if (replyRaw !== null && (typeof replyRaw !== "string" || replyRaw.length === 0 || replyRaw.length > 100)) {
      return apiError(422, "invalid", "Mensagem citada inválida");
    }
    const replyToMessageId = typeof replyRaw === "string" && replyRaw.length <= 100 && replyRaw.length > 0
      ? replyRaw
      : undefined;
    try {
      await sendBaileysMedia(session.organizationId, chatId, {
        data: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "application/octet-stream",
        fileName: file.name || undefined,
        caption,
        voice: form?.get("voice") === "1",
        replyToMessageId,
      });
      return Response.json({ ok: true }, { status: 201 });
    } catch (error) {
      if (error instanceof MediaValidationError) {
        return apiError(error.code === "too_large" ? 413 : 415, error.code, error.message);
      }
      console.warn(`[baileys] falha no envio de mídia: ${error instanceof Error ? error.message.slice(0, 160) : "erro"}`);
      return apiError(409, "send_failed", "Não foi possível enviar a mídia pelo WhatsApp");
    }
  }
  const body = await parseBody(req, actionSchema);
  if (!body.ok) return body.response;
  if ((body.data.action === "connect" || body.data.action === "disconnect") && !canConfigure(session.role)) {
    return apiError(403, "forbidden", "Sem permissão para administrar a conexão");
  }
  if (body.data.action === "connect") await pairBaileys(session.organizationId);
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
      await sendText(session.organizationId, body.data.chatId, body.data.text, body.data.replyToMessageId);
    } catch (error) {
      return apiError(409, "send_failed", error instanceof Error ? error.message : "Falha no envio");
    }
  }
  return Response.json({ ok: true });
});
