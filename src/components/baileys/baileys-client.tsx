"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, LoaderCircle, LogOut, QrCode } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Composer } from "@/components/inbox/composer";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";

type Connection = { status: string; phone: string | null; error: string | null };
type Participant = { jid: string; admin?: string | null };
type Chat = { id: string; name: string | null; phone: string | null; isGroup: boolean; avatarUrl: string | null; participants: Participant[] | null; stageId: string | null; stageName: string | null; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number };
type RawMedia = { id: string; kind: "image" | "video" | "audio" | "document" | "sticker"; mimeType: string | null; fileName: string | null; fileSize: number | null; caption: string | null; fetchStatus: "available" | "pending" | "failed"; payload: unknown };
type RawMessage = { id: string; chatId: string; direction: "in" | "out"; type: string; text: string | null; status: string; occurredAt: string; media: RawMedia | null };
type Stage = { id: string; name: string; kind: string };
type Snapshot = { connection: Connection; qr: string | null; syncing: boolean; syncProgress: number; chats: Chat[]; stages: Stage[]; messages: RawMessage[] };

const STATUS: Record<string, string> = { disconnected: "Desconectado", waiting_qr: "Aguardando QR", connecting: "Conectando", connected: "Conectado", reconnecting: "Reconectando", error: "Erro" };

function toConversation(chat: Chat, connected: boolean): ConversationDto {
  return { id: chat.id, channel: "whatsapp", contact: { id: `baileys:${chat.id}`, name: chat.name || chat.phone || "Conversa", phone: chat.phone, avatarUrl: chat.avatarUrl }, stageName: chat.stageName, aiEnabled: false, handoffAt: null, handoffReason: null, lastInboundAt: chat.lastMessageAt, lastMessageAt: chat.lastMessageAt, unreadCount: chat.unreadCount, windowOpen: connected, windowRemainingMs: connected ? Number.MAX_SAFE_INTEGER : 0, humanWindow: null, composer: { media: false, structured: false, quoteReply: false }, preview: chat.lastMessage, anuncio: null };
}

function toMessage(message: RawMessage): MessageDto {
  const allowed = new Set(["pending", "sent", "delivered", "read", "failed"]);
  return { id: message.id, conversationId: message.chatId, direction: message.direction, type: message.type, text: message.text, status: (allowed.has(message.status) ? message.status : "sent") as MessageDto["status"], error: null, aiGenerated: false, origin: "operator", media: message.media ? { assetId: message.media.id, kind: message.media.kind, mimeType: message.media.mimeType, fileName: message.media.fileName, fileSize: message.media.fileSize, caption: message.media.caption, fetchStatus: message.media.fetchStatus, payload: message.media.payload } : null, quotable: false, replyTo: null, createdAt: message.occurredAt };
}

export function BaileysClient() {
  const searchParams = useSearchParams();
  const initialChatId = searchParams.get("chat");
  const [data, setData] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialChatId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const load = useCallback(async (chatId = selectedRef.current) => {
    const response = await fetch(`/api/baileys${chatId ? `?chatId=${encodeURIComponent(chatId)}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar a bandeja Baileys");
    setData((await response.json()) as Snapshot);
  }, []);
  useEffect(() => { void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro")); }, [load]);
  useEffect(() => { const source = new EventSource("/api/events"); const refresh = () => void load().catch(() => undefined); source.addEventListener("baileys.updated", refresh); return () => source.close(); }, [load]);
  useEffect(() => {
    const status = data?.connection.status;
    if (!status || (!["connecting", "reconnecting", "waiting_qr"].includes(status) && !data?.syncing)) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
  }, [data?.connection.status, data?.syncing, load]);

  async function action(payload: object): Promise<string | null> {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/baileys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "Operação falhou");
      await load(); return null;
    } catch (e) { const message = e instanceof Error ? e.message : "Operação falhou"; setError(message); return message; }
    finally { setBusy(false); }
  }

  const connected = data?.connection.status === "connected";
  const conversations = useMemo(() => connected ? (data?.chats ?? []).map((chat) => toConversation(chat, true)) : [], [data?.chats, connected]);
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const selectedChat = data?.chats.find((chat) => chat.id === selectedId) ?? null;
  const messages = useMemo(() => (data?.messages ?? []).map(toMessage), [data?.messages]);
  const connectionAction = connected ? (
    <button type="button" disabled={busy} title="Desconectar Baileys" aria-label="Desconectar Baileys" onClick={() => confirm("Desconectar e remover a sessão deste aparelho?") && void action({ action: "disconnect" })} className="rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground disabled:opacity-50"><LogOut className="h-4 w-4" /></button>
  ) : (
    <button type="button" disabled={busy} title="Conectar WhatsApp Web" aria-label="Conectar WhatsApp Web" onClick={() => void action({ action: "connect" })} className="rounded-md p-1.5 text-brand-ink hover:bg-brand-tint disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}</button>
  );

  return <div className="flex h-full lg:gap-[var(--hueco)]">
    <section className={cn("w-full shrink-0 overflow-hidden md:w-[300px] md:border-r lg:w-[340px] lg:overflow-visible lg:border-r-0", selected && "max-md:hidden")}>
      {connected && data?.syncing ? <div className="flex h-full flex-col bg-background p-4 lg:tarjeta"><div className="flex items-center justify-between"><h2 className="font-semibold">Baileys</h2>{connectionAction}</div><div className="mt-8 flex items-center gap-2 text-sm text-text-2"><LoaderCircle className="h-4 w-4 animate-spin"/>Carregando conversas… {data.syncProgress > 0 ? `${data.syncProgress}%` : ""}</div><div className="mt-5 space-y-3" aria-hidden>{[1,2,3,4,5].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div></div> : <ConversationList conversations={data ? conversations : null} channels={["whatsapp"]} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); void action({ action: "mark_read", chatId: id }); void load(id); }} onSeeded={() => void load()} title="Baileys" simple headerAction={connectionAction} />}
    </section>
    <section className={cn("flex min-w-0 flex-1 flex-col lg:gap-[var(--hueco)]", !selected && "max-md:hidden")}>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">{error}</p>}
      {selected ? <>
        <header className="flex items-center justify-between gap-1 border-b bg-background px-2 py-2.5 md:px-4 lg:tarjeta lg:border-b-0 lg:px-5 lg:py-3">
          <button onClick={() => setSelectedId(null)} aria-label="Voltar às conversas" className="shrink-0 rounded-md p-1.5 text-text-2 hover:bg-accent md:hidden"><ChevronLeft className="h-5 w-5" /></button>
          <div className="flex min-w-0 flex-1 items-center gap-3 p-1">
            <ContactAvatar name={selected.contact.name} seed={selected.contact.id} src={selected.contact.avatarUrl} size="md" />
            <div className="min-w-0"><p className="truncate text-[15px] font-bold leading-tight lg:text-[18px] lg:font-semibold">{selected.contact.name}</p><p className="mt-0.5 font-mono text-[10.5px] tracking-[0.04em] text-text-3">{selectedChat?.isGroup ? `Grupo · ${selectedChat.participants?.length ?? 0} participantes` : selected.contact.phone ? formatPhone(selected.contact.phone) : "WhatsApp Web"}</p>{selectedChat?.isGroup && selectedChat.participants?.length ? <p className="max-w-lg truncate text-[10px] text-text-3" title={selectedChat.participants.map((p) => p.jid).join(", ")}>{selectedChat.participants.slice(0, 5).map((p) => p.jid.split("@")[0]).join(", ")}{selectedChat.participants.length > 5 ? "…" : ""}</p> : null}</div>
          </div>
          <select
            aria-label="Etapa da conversa"
            value={data?.chats.find((chat) => chat.id === selected.id)?.stageId ?? ""}
            onChange={(event) => void action({ action: "set_stage", chatId: selected.id, stageId: event.target.value })}
            className="max-w-40 rounded-full border border-border-strong bg-background px-2 py-1 text-[11px] font-semibold text-text-2"
          >
            <option value="" disabled>Selecionar etapa</option>
            {(data?.stages ?? []).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
          <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", connected ? "bg-success-soft text-success-text" : "bg-warning-soft text-warning-text")}>{STATUS[data?.connection.status ?? "disconnected"]}</span>
        </header>
        <Composer key={selected.id} conversation={selected} templatesEnabled={false} onSend={async (text) => action({ action: "send", chatId: selected.id, text })} onSent={() => void load(selected.id)}><MessageThread messages={messages} contactName={selected.contact.name} /></Composer>
      </> : <div className="thread-bg flex flex-1 flex-col items-center justify-center gap-3 bg-chat px-6 text-center lg:tarjeta">
        {data?.qr ? <><Image unoptimized width={256} height={256} src={data.qr} alt="QR Code para conectar o WhatsApp" className="h-64 w-64 rounded-lg border bg-white p-2" /><p className="max-w-sm text-sm text-text-2">No celular, abra WhatsApp → Aparelhos conectados → Conectar um aparelho e escaneie este QR Code.</p></> : <><p className="font-serif text-[24px] italic leading-tight text-text-2">{connected ? "Escolha uma conversa para ver o histórico" : "Conecte o WhatsApp Web para carregar suas conversas"}</p><p className="kicker">Baileys · {STATUS[data?.connection.status ?? "disconnected"]}</p>{!connected && <button disabled={busy} onClick={() => void action({ action: "connect" })} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg disabled:opacity-50">Conectar WhatsApp</button>}</>}
      </div>}
    </section>
  </div>;
}
