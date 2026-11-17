import type { proto } from "@whiskeysockets/baileys";

export type BaileysContent = {
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contacts" | "unsupported";
  text: string | null;
  preview: string;
  payload?: unknown;
};

export type BaileysQuotedContext = {
  providerId: string;
  participant: string | null;
  type: BaileysContent["type"];
  text: string | null;
};

type Message = proto.IMessage;

function safeText(value: string | null | undefined, max: number): string | undefined {
  const clean = value?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gi, "").trim();
  return clean ? clean.slice(0, max) : undefined;
}

function phonesFromVcard(vcard: string | null | undefined): Array<{ phone: string }> {
  if (!vcard) return [];
  const phones: Array<{ phone: string }> = [];
  const lines = vcard.slice(0, 65_536).replace(/\r?\n[ \t]/g, "").split(/\r?\n/, 1_000);
  for (const line of lines) {
    if (!/^TEL(?:;|:)/i.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const raw = line.slice(separator + 1).replace(/^tel:/i, "").trim();
    const normalized = raw.replace(/[^\d+]/g, "").slice(0, 20);
    if (/^\+?\d{7,20}$/.test(normalized) && !phones.some((item) => item.phone === normalized)) {
      phones.push({ phone: normalized });
      if (phones.length === 5) break;
    }
  }
  return phones;
}

function contactPayload(contact: { displayName?: string | null; vcard?: string | null }) {
  const name = safeText(contact.displayName, 160) ?? "Contato";
  return { name, phones: phonesFromVcard(contact.vcard) };
}

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

/** Extrai apenas o snapshot seguro necessário para exibir uma resposta citada. */
export function baileysQuotedContext(raw: Message | null | undefined): BaileysQuotedContext | null {
  const message = unwrapBaileysMessage(raw);
  if (!message) return null;
  const context =
    message.extendedTextMessage?.contextInfo ??
    message.imageMessage?.contextInfo ??
    message.audioMessage?.contextInfo ??
    message.videoMessage?.contextInfo ??
    message.documentMessage?.contextInfo ??
    message.stickerMessage?.contextInfo ??
    message.contactMessage?.contextInfo ??
    message.contactsArrayMessage?.contextInfo ??
    message.locationMessage?.contextInfo ??
    message.liveLocationMessage?.contextInfo;
  const providerId = safeText(context?.stanzaId, 100);
  if (!providerId) return null;
  const quoted = baileysMessageContent(context?.quotedMessage);
  return {
    providerId,
    participant: safeText(context?.participant, 160) ?? null,
    type: quoted?.type ?? "unsupported",
    text: safeText(quoted?.text ?? quoted?.preview, 200) ?? null,
  };
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
    const payload = contactPayload(message.contactMessage);
    return { type: "contacts", text: null, preview: `[Contato: ${payload.name}]`, payload: [payload] };
  }
  if (message.contactsArrayMessage) {
    const contacts = (message.contactsArrayMessage.contacts ?? []).slice(0, 50).map(contactPayload);
    return { type: "contacts", text: null, preview: contacts.length === 1 ? `[Contato: ${contacts[0]!.name}]` : `[Contatos: ${contacts.length}]`, payload: contacts };
  }
  const location = message.locationMessage ?? message.liveLocationMessage;
  if (location) {
    const latitude = Number(location.degreesLatitude);
    const longitude = Number(location.degreesLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return { type: "unsupported", text: null, preview: "[Localização inválida]" };
    }
    const name = safeText(message.locationMessage?.name, 160);
    const address = safeText(message.locationMessage?.address, 500);
    return {
      type: "location",
      text: null,
      preview: name ? `[Localização: ${name}]` : "[Localização]",
      payload: { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) },
    };
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
