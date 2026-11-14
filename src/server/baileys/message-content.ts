import type { proto } from "@whiskeysockets/baileys";

export type BaileysContent = {
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "unsupported";
  text: string | null;
  preview: string;
};

type Message = proto.IMessage;

/** Retira envelopes usados pelo WhatsApp sem transformar eventos internos em conversas. */
export function unwrapBaileysMessage(message: Message | null | undefined): Message | null {
  if (!message) return null;
  const nested =
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.viewOnceMessageV2Extension?.message ??
    message.documentWithCaptionMessage?.message;
  return nested ? unwrapBaileysMessage(nested) : message;
}

export function baileysMessageContent(raw: Message | null | undefined): BaileysContent | null {
  const message = unwrapBaileysMessage(raw);
  if (!message) return null;

  // ACKs, revogações, reações e chaves de sessão não são mensagens de usuário.
  if (
    message.protocolMessage ||
    message.senderKeyDistributionMessage ||
    message.messageContextInfo ||
    message.reactionMessage ||
    message.keepInChatMessage
  ) {
    return null;
  }

  const plain = message.conversation?.trim();
  if (plain) return { type: "text", text: plain, preview: plain };
  const extended = message.extendedTextMessage?.text?.trim();
  if (extended) return { type: "text", text: extended, preview: extended };

  const imageCaption = message.imageMessage?.caption?.trim() || null;
  if (message.imageMessage) return { type: "image", text: imageCaption, preview: imageCaption || "[Imagem]" };
  if (message.audioMessage) return { type: "audio", text: null, preview: "[Áudio]" };
  const videoCaption = message.videoMessage?.caption?.trim() || null;
  if (message.videoMessage) return { type: "video", text: videoCaption, preview: videoCaption || "[Vídeo]" };
  if (message.documentMessage) {
    const caption = message.documentMessage.caption?.trim() || null;
    const name = message.documentMessage.fileName?.trim();
    return { type: "document", text: caption, preview: caption || (name ? `[Documento: ${name}]` : "[Documento]") };
  }
  if (message.stickerMessage) return { type: "sticker", text: null, preview: "[Figurinha]" };
  if (message.contactMessage) {
    const name = message.contactMessage.displayName?.trim();
    return { type: "unsupported", text: null, preview: name ? `[Contato: ${name}]` : "[Contato]" };
  }
  if (message.contactsArrayMessage) return { type: "unsupported", text: null, preview: "[Contatos]" };
  if (message.locationMessage || message.liveLocationMessage) {
    return { type: "unsupported", text: null, preview: "[Localização]" };
  }

  const button = message.buttonsResponseMessage?.selectedDisplayText?.trim();
  if (button) return { type: "text", text: button, preview: button };
  const templateButton = message.templateButtonReplyMessage?.selectedDisplayText?.trim();
  if (templateButton) return { type: "text", text: templateButton, preview: templateButton };
  const list = message.listResponseMessage?.title?.trim() || message.listResponseMessage?.singleSelectReply?.selectedRowId?.trim();
  if (list) return { type: "text", text: list, preview: list };

  // Envelopes desconhecidos costumam ser sync/controle interno. Sem um tipo
  // de conteúdo reconhecido, não há mensagem de usuário segura para exibir.
  return null;
}
