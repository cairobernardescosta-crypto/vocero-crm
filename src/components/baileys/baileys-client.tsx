"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, LoaderCircle, LogOut, MessageCircle, Phone, QrCode, Search, Users, X } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Composer } from "@/components/inbox/composer";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";

type Connection = { status: string; phone: string | null; error: string | null };
type Participant = { jid: string; admin?: string | null };
type Chat = { id: string; name: string | null; phone: string | null; isGroup: boolean; avatarUrl: string | null; participants: Participant[] | null; stageId: string | null; stageName: string | null; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number };
type RawMedia = { id: string; kind: "image" | "video" | "audio" | "document" | "sticker" | "location" | "contacts"; mimeType: string | null; fileName: string | null; fileSize: number | null; caption: string | null; fetchStatus: "available" | "pending" | "failed"; payload: unknown };
type RawMessage = { id: string; chatId: string; providerId: string; direction: "in" | "out"; type: string; text: string | null; status: string; occurredAt: string; media: RawMedia | null; replyTo: MessageDto["replyTo"] };
type Stage = { id: string; name: string; kind: string };
type ParticipantDetail = { jid: string; name: string | null; phone: string | null; admin: "admin" | "superadmin" | null };
type Snapshot = { connection: Connection; qr: string | null; syncing: boolean; syncProgress: number; syncError: string | null; chats: Chat[]; stages: Stage[]; selectedDetails: { participants: ParticipantDetail[]; messageCount: number; firstMessageAt: string | null; lastMessageAt: string | null } | null; messages: RawMessage[]; pagination: { chatsNextCursor: string | null; messagesNextCursor: string | null } };
type SearchResult = { messageId: string; chatId: string; chatName: string | null; chatPhone: string | null; avatarUrl: string | null; text: string | null; direction: "in" | "out"; occurredAt: string };

const STATUS: Record<string, string> = { disconnected: "Desconectado", waiting_qr: "Aguardando QR", connecting: "Conectando", connected: "Conectado", reconnecting: "Reconectando", error: "Erro" };

function toConversation(chat: Chat, connected: boolean): ConversationDto {
  return { id: chat.id, channel: "whatsapp", contact: { id: `baileys:${chat.id}`, name: chat.name || chat.phone || "Conversa", phone: chat.phone, avatarUrl: chat.avatarUrl }, stageName: chat.stageName, aiEnabled: false, handoffAt: null, handoffReason: null, lastInboundAt: chat.lastMessageAt, lastMessageAt: chat.lastMessageAt, unreadCount: chat.unreadCount, windowOpen: connected, windowRemainingMs: connected ? Number.MAX_SAFE_INTEGER : 0, humanWindow: null, composer: { media: connected, structured: false, quoteReply: connected }, preview: chat.lastMessage, anuncio: null };
}

function toMessage(message: RawMessage): MessageDto {
  const allowed = new Set(["pending", "sent", "delivered", "read", "failed"]);
  return { id: message.id, conversationId: message.chatId, direction: message.direction, type: message.type, text: message.text, status: (allowed.has(message.status) ? message.status : "sent") as MessageDto["status"], error: null, aiGenerated: false, origin: "operator", media: message.media ? { assetId: message.media.id, kind: message.media.kind, mimeType: message.media.mimeType, fileName: message.media.fileName, fileSize: message.media.fileSize, caption: message.media.caption, fetchStatus: message.media.fetchStatus, payload: message.media.payload } : null, quotable: Boolean(message.providerId && !message.providerId.startsWith("failed:")), replyTo: message.replyTo, createdAt: message.occurredAt };
}

export function BaileysClient() {
  const searchParams = useSearchParams();
  const initialChatId = searchParams.get("chat");
  const [data, setData] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialChatId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [chatsNextCursor, setChatsNextCursor] = useState<string | null>(null);
  const [messagesNextCursor, setMessagesNextCursor] = useState<string | null>(null);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  selectedRef.current = selectedId;

  const load = useCallback(async (chatId = selectedRef.current, page: { chatCursor?: string; messageCursor?: string; aroundMessageId?: string } = {}) => {
    const params = new URLSearchParams();
    if (chatId) params.set("chatId", chatId);
    if (page.chatCursor) params.set("chatCursor", page.chatCursor);
    if (page.messageCursor) params.set("messageCursor", page.messageCursor);
    if (page.aroundMessageId) params.set("aroundMessageId", page.aroundMessageId);
    const response = await fetch(`/api/baileys${params.size ? `?${params}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar a bandeja Baileys");
    const next = (await response.json()) as Snapshot;
    const sameChat = chatId === selectedRef.current;
    if (!initializedRef.current) {
      initializedRef.current = true;
      setChatsNextCursor(next.pagination.chatsNextCursor);
      setMessagesNextCursor(next.pagination.messagesNextCursor);
    } else {
      if (page.chatCursor) setChatsNextCursor(next.pagination.chatsNextCursor);
      if (sameChat && (page.messageCursor || chatId)) setMessagesNextCursor(next.pagination.messagesNextCursor);
    }
    setData((previous) => {
      if (!previous) return next;
      const chatMap = new Map(previous.chats.map((item) => [item.id, item]));
      for (const item of next.chats) chatMap.set(item.id, item);
      const chats = [...chatMap.values()].sort((a, b) => Date.parse(b.lastMessageAt ?? "0") - Date.parse(a.lastMessageAt ?? "0"));
      if (!sameChat) return { ...previous, connection: next.connection, qr: next.qr, syncing: next.syncing, syncProgress: next.syncProgress, syncError: next.syncError, chats, stages: next.stages };
      const previousBelongsToChat = previous.messages.every((item) => item.chatId === chatId);
      const messageMap = new Map((page.aroundMessageId || !previousBelongsToChat ? [] : previous.messages).map((item) => [item.id, item]));
      for (const item of next.messages) messageMap.set(item.id, item);
      const messages = [...messageMap.values()].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
      return { ...next, chats, messages };
    });
    setError(null);
  }, []);

  const loadMoreChats = useCallback(async () => {
    if (!chatsNextCursor || loadingMoreChats) return;
    setLoadingMoreChats(true);
    try { await load(selectedRef.current, { chatCursor: chatsNextCursor }); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar mais conversas"); }
    finally { setLoadingMoreChats(false); }
  }, [chatsNextCursor, load, loadingMoreChats]);

  const loadMoreMessages = useCallback(async () => {
    if (!selectedRef.current || !messagesNextCursor || loadingMoreMessages) return;
    setLoadingMoreMessages(true);
    try { await load(selectedRef.current, { messageCursor: messagesNextCursor }); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar mensagens anteriores"); }
    finally { setLoadingMoreMessages(false); }
  }, [load, loadingMoreMessages, messagesNextCursor]);
  useEffect(() => { void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro")); }, [load]);
  useEffect(() => {
    const source = new EventSource("/api/events");
    const refresh = () => void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível atualizar a bandeja Baileys"));
    source.addEventListener("baileys.updated", refresh);
    source.onerror = () => setError("A atualização em tempo real foi interrompida. Tente novamente.");
    return () => source.close();
  }, [load]);
  useEffect(() => {
    const status = data?.connection.status;
    if (!status || (!["connecting", "reconnecting", "waiting_qr"].includes(status) && !data?.syncing)) return;
    const timer = window.setInterval(() => void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível atualizar a conexão Baileys")), 2000);
    return () => window.clearInterval(timer);
  }, [data?.connection.status, data?.syncing, load]);
  useEffect(() => {
    if (!detailsOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDetailsOpen(false);
      detailsTriggerRef.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [detailsOpen]);
  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSearchOpen(false); searchTriggerRef.current?.focus(); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [searchOpen]);
  useEffect(() => { setDetailsOpen(false); setReplyTo(null); }, [selectedId]);

  async function action(payload: object, refresh = true): Promise<string | null> {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/baileys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "Operação falhou");
      if (refresh) await load();
      return null;
    } catch (e) { const message = e instanceof Error ? e.message : "Operação falhou"; setError(message); return message; }
    finally { setBusy(false); }
  }

  async function searchMessages(append = false) {
    const query = searchQuery.trim();
    if (query.length < 2 || query.length > 100 || searchLoading) return;
    setSearchLoading(true); setSearchError(null);
    try {
      const params = new URLSearchParams({ q: query });
      if (append && searchCursor) params.set("cursor", searchCursor);
      const response = await fetch(`/api/baileys/search?${params}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { results?: SearchResult[]; nextCursor?: string | null; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "Não foi possível pesquisar mensagens");
      setSearchResults((previous) => append ? [...previous, ...(body?.results ?? [])] : (body?.results ?? []));
      setSearchCursor(body?.nextCursor ?? null);
    } catch (e) { setSearchError(e instanceof Error ? e.message : "Não foi possível pesquisar mensagens"); }
    finally { setSearchLoading(false); }
  }

  async function openSearchResult(result: SearchResult) {
    selectedRef.current = result.chatId;
    setSelectedId(result.chatId); setFocusMessageId(result.messageId); setSearchOpen(false);
    try { await load(result.chatId, { aroundMessageId: result.messageId }); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível abrir a mensagem"); }
  }

  const connected = data?.connection.status === "connected";
  const conversations = useMemo(() => (data?.chats ?? []).map((chat) => toConversation(chat, connected)), [data?.chats, connected]);
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const selectedChat = data?.chats.find((chat) => chat.id === selectedId) ?? null;
  const messages = useMemo(() => (data?.messages ?? []).map(toMessage), [data?.messages]);
  const participantPreview = (data?.selectedDetails?.participants ?? []).slice(0, 5)
    .map((participant) => participant.name || (participant.phone ? formatPhone(participant.phone) : "Participante"))
    .join(", ");
  const connectionAction = connected ? (
    <button type="button" disabled={busy} title="Desconectar Baileys" aria-label="Desconectar Baileys" onClick={() => confirm("Desconectar e remover a sessão deste aparelho?") && void action({ action: "disconnect" })} className="rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground disabled:opacity-50"><LogOut className="h-4 w-4" /></button>
  ) : (
    <button type="button" disabled={busy} title="Conectar WhatsApp Web" aria-label="Conectar WhatsApp Web" onClick={() => void action({ action: "connect" })} className="rounded-md p-1.5 text-brand-ink hover:bg-brand-tint disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}</button>
  );
  const headerActions = <div className="flex items-center gap-1"><button ref={searchTriggerRef} type="button" title="Pesquisar mensagens" aria-label="Pesquisar mensagens" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)} className="rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground"><Search className="h-4 w-4" /></button>{connectionAction}</div>;

  return <div className="flex h-full lg:gap-[var(--hueco)]">
    <section className={cn("flex w-full shrink-0 flex-col overflow-hidden md:w-[300px] md:border-r lg:w-[340px] lg:overflow-visible lg:border-r-0", selected && "max-md:hidden")}>
      {error && <div role="alert" className="m-2 flex items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger-text md:hidden"><span>{error}</span><button type="button" onClick={() => void load()} className="shrink-0 rounded-md border border-current px-2 py-1 font-semibold">Tentar novamente</button></div>}
      {!connected && data && <p role="status" className="mx-2 mb-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-text md:hidden">Histórico salvo disponível. Conecte o WhatsApp para receber e enviar novas mensagens.</p>}
      <div className="min-h-0 flex-1">{connected && data?.syncing && !data.syncError && data.syncProgress < 100 && data.chats.length === 0 ? <div className="flex h-full flex-col bg-background p-4 lg:tarjeta"><div className="flex items-center justify-between"><h2 className="font-semibold">Baileys</h2>{headerActions}</div><div className="mt-8 flex items-center gap-2 text-sm text-text-2" role="status" aria-live="polite"><LoaderCircle className="h-4 w-4 animate-spin"/>Carregando conversas… {data.syncProgress > 0 ? `${data.syncProgress}%` : ""}</div><div className="mt-5 space-y-3" aria-hidden>{[1,2,3,4,5].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div></div> : <ConversationList conversations={data ? conversations : null} channels={["whatsapp"]} selectedId={selectedId} onSelect={(id) => { selectedRef.current = id; setSelectedId(id); setFocusMessageId(null); void action({ action: "mark_read", chatId: id }, false); void load(id); }} onSeeded={() => void load()} title="Baileys" simple headerAction={headerActions} hasMore={Boolean(chatsNextCursor)} loadingMore={loadingMoreChats} onLoadMore={() => void loadMoreChats()} />}</div>
    </section>
    <section className={cn("flex min-w-0 flex-1 flex-col lg:gap-[var(--hueco)]", !selected && "max-md:hidden")}>
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text"><span>{error}</span><button type="button" onClick={() => void load()} className="shrink-0 rounded-md border border-current px-2 py-1 text-xs font-semibold">Tentar novamente</button></div>}
      {data?.syncError && <div role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">Sincronização parcial: {data.syncError}. Reconecte para tentar novamente.</div>}
      {!connected && data && <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text"><span>Histórico salvo disponível. Conecte o WhatsApp para receber e enviar novas mensagens.</span><button type="button" disabled={busy} onClick={() => void action({ action: "connect" })} className="shrink-0 rounded-md border border-current px-2 py-1 text-xs font-semibold disabled:opacity-50">Conectar</button></div>}
      {selected ? <>
        <header className="flex items-center justify-between gap-1 border-b bg-background px-2 py-2.5 md:px-4 lg:tarjeta lg:border-b-0 lg:px-5 lg:py-3">
          <button onClick={() => setSelectedId(null)} aria-label="Voltar às conversas" className="shrink-0 rounded-md p-1.5 text-text-2 hover:bg-accent md:hidden"><ChevronLeft className="h-5 w-5" /></button>
          <button ref={detailsTriggerRef} type="button" aria-expanded={detailsOpen} aria-controls="baileys-chat-details" onClick={() => setDetailsOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ContactAvatar name={selected.contact.name} seed={selected.contact.id} src={selected.contact.avatarUrl} size="md" />
            <div className="min-w-0"><p className="truncate text-[15px] font-bold leading-tight lg:text-[18px] lg:font-semibold">{selected.contact.name}</p><p className="mt-0.5 font-mono text-[10.5px] tracking-[0.04em] text-text-3">{selectedChat?.isGroup ? `Grupo · ${selectedChat.participants?.length ?? 0} participantes` : selected.contact.phone ? formatPhone(selected.contact.phone) : "WhatsApp Web"}</p>{selectedChat?.isGroup && participantPreview ? <p className="max-w-lg truncate text-[10px] text-text-3" title={participantPreview}>{participantPreview}{(selectedChat.participants?.length ?? 0) > 5 ? "…" : ""}</p> : null}</div>
          </button>
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
        <Composer key={selected.id} conversation={selected} templatesEnabled={false} mediaEndpoint={`/api/baileys?chatId=${encodeURIComponent(selected.id)}`} replyTo={replyTo} onReplyChange={setReplyTo} onSend={async (text, quoted) => action({ action: "send", chatId: selected.id, text, replyToMessageId: quoted?.id })} onSent={() => void load(selected.id)}>{messagesNextCursor && <div className="bg-chat p-2 text-center"><button type="button" disabled={loadingMoreMessages} onClick={() => void loadMoreMessages()} className="rounded-lg border border-border-strong bg-background px-3 py-2 text-xs font-semibold disabled:opacity-50">{loadingMoreMessages ? "Carregando…" : "Carregar mensagens anteriores"}</button></div>}<MessageThread messages={messages} contactName={selected.contact.name} preserveScrollOnPrepend focusMessageId={focusMessageId} onReply={connected ? setReplyTo : undefined} /></Composer>
      </> : <div className="thread-bg flex flex-1 flex-col items-center justify-center gap-3 bg-chat px-6 text-center lg:tarjeta">
        {data?.qr ? <><Image unoptimized width={256} height={256} src={data.qr} alt="QR Code para conectar o WhatsApp" className="h-64 w-64 rounded-lg border bg-white p-2" /><p className="max-w-sm text-sm text-text-2">No celular, abra WhatsApp → Aparelhos conectados → Conectar um aparelho e escaneie este QR Code.</p></> : <><p className="font-serif text-[24px] italic leading-tight text-text-2">{connected ? "Escolha uma conversa para ver o histórico" : "Conecte o WhatsApp Web para carregar suas conversas"}</p><p className="kicker">Baileys · {STATUS[data?.connection.status ?? "disconnected"]}</p>{!connected && <button disabled={busy} onClick={() => void action({ action: "connect" })} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg disabled:opacity-50">Conectar WhatsApp</button>}</>}
      </div>}
    </section>
    {searchOpen && <aside role="dialog" aria-modal="true" aria-label="Pesquisar mensagens do Baileys" className="fixed inset-0 z-[60] flex flex-col bg-background p-4 md:left-auto md:w-[430px] md:border-l md:shadow-xl">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Pesquisar mensagens</h2><button type="button" aria-label="Fechar pesquisa" onClick={() => { setSearchOpen(false); searchTriggerRef.current?.focus(); }} className="rounded-md p-2 hover:bg-accent"><X className="h-5 w-5" /></button></div>
      <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); setSearchResults([]); setSearchCursor(null); void searchMessages(false); }}><input ref={searchInputRef} value={searchQuery} maxLength={100} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Digite ao menos 2 caracteres" aria-label="Texto da mensagem" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><button type="submit" disabled={searchLoading || searchQuery.trim().length < 2} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-fg disabled:opacity-50">Buscar</button></form>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto" aria-live="polite">{searchLoading && !searchResults.length ? <p className="flex items-center gap-2 text-sm text-text-2"><LoaderCircle className="h-4 w-4 animate-spin" />Pesquisando…</p> : searchError ? <div role="alert"><p className="text-sm text-danger-text">{searchError}</p><button type="button" onClick={() => void searchMessages(false)} className="mt-2 text-sm font-semibold underline">Tentar novamente</button></div> : searchResults.length ? <ul className="space-y-2">{searchResults.map((result) => <li key={result.messageId}><button type="button" onClick={() => void openSearchResult(result)} className="w-full rounded-lg border p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="truncate text-sm font-semibold">{result.chatName || result.chatPhone || "Conversa"}</p><p className="mt-1 line-clamp-2 text-sm text-text-2">{result.text}</p><time className="mt-1 block text-xs text-text-3">{new Date(result.occurredAt).toLocaleString("pt-BR")}</time></button></li>)}</ul> : searchQuery.trim().length >= 2 ? <p className="text-sm text-text-3">Nenhuma mensagem encontrada.</p> : <p className="text-sm text-text-3">Pesquise no texto das mensagens salvas.</p>}</div>
      {searchCursor && <button type="button" disabled={searchLoading} onClick={() => void searchMessages(true)} className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{searchLoading ? "Carregando…" : "Carregar mais"}</button>}
    </aside>}
    {selected && detailsOpen && <aside id="baileys-chat-details" aria-label={selectedChat?.isGroup ? "Detalhes do grupo" : "Detalhes do contato"} className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-5 md:static md:z-auto md:w-80 md:shrink-0 md:rounded-xl md:border">
      <div className="flex justify-end"><button type="button" aria-label="Fechar detalhes" onClick={() => { setDetailsOpen(false); detailsTriggerRef.current?.focus(); }} className="rounded-md p-2 text-text-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-5 w-5" /></button></div>
      <div className="flex flex-col items-center text-center">
        <ContactAvatar name={selected.contact.name} seed={selected.contact.id} src={selected.contact.avatarUrl} size="lg" />
        <h2 className="mt-3 break-words text-lg font-semibold">{selected.contact.name}</h2>
        <p className="mt-1 text-sm text-text-3">{selectedChat?.isGroup ? `${data?.selectedDetails?.participants.length ?? 0} participantes` : selected.contact.phone ? formatPhone(selected.contact.phone) : "WhatsApp Web"}</p>
      </div>
      {!selectedChat?.isGroup && <section className="mt-6 space-y-3" aria-label="Informações do contato">
        <div className="rounded-xl border bg-subtle/40 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-3">Contato</h3>
          <dl className="mt-3 space-y-3 text-sm">
            <div className="flex items-center gap-3"><Phone className="h-4 w-4 shrink-0 text-text-3" /><div><dt className="text-xs text-text-3">Telefone</dt><dd className="font-medium">{selected.contact.phone ? formatPhone(selected.contact.phone) : "Não identificado"}</dd></div></div>
            <div className="flex items-center gap-3"><MessageCircle className="h-4 w-4 shrink-0 text-text-3" /><div><dt className="text-xs text-text-3">Mensagens salvas</dt><dd className="font-medium">{data?.selectedDetails?.messageCount ?? 0}</dd></div></div>
            <div className="flex items-center gap-3"><CalendarDays className="h-4 w-4 shrink-0 text-text-3" /><div><dt className="text-xs text-text-3">Primeira mensagem</dt><dd className="font-medium">{data?.selectedDetails?.firstMessageAt ? new Date(data.selectedDetails.firstMessageAt).toLocaleString("pt-BR") : "Ainda não disponível"}</dd></div></div>
            <div className="flex items-center gap-3"><CalendarDays className="h-4 w-4 shrink-0 text-text-3" /><div><dt className="text-xs text-text-3">Última mensagem</dt><dd className="font-medium">{data?.selectedDetails?.lastMessageAt ? new Date(data.selectedDetails.lastMessageAt).toLocaleString("pt-BR") : "Ainda não disponível"}</dd></div></div>
          </dl>
        </div>
        <label className="block rounded-xl border p-3 text-left text-sm"><span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-text-3">Etapa da pipeline</span><select aria-label="Etapa do contato" value={selectedChat?.stageId ?? ""} onChange={(event) => void action({ action: "set_stage", chatId: selected.id, stageId: event.target.value })} className="w-full rounded-lg border bg-background px-3 py-2"><option value="" disabled>Selecionar etapa</option>{(data?.stages ?? []).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <div className="flex items-center justify-between rounded-xl border p-3 text-sm"><span>Status do WhatsApp</span><span className={cn("rounded-full px-2 py-1 text-xs font-semibold", connected ? "bg-success-soft text-success-text" : "bg-warning-soft text-warning-text")}>{STATUS[data?.connection.status ?? "disconnected"]}</span></div>
      </section>}
      {selectedChat?.isGroup && <section className="mt-6" aria-labelledby="baileys-participants-title">
        <h3 id="baileys-participants-title" className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" /> Participantes</h3>
        <ul className="mt-3 space-y-2">
          {(data?.selectedDetails?.participants ?? []).map((participant) => {
            const label = participant.name || (participant.phone ? formatPhone(participant.phone) : "Participante");
            return <li key={participant.jid} className="flex items-center gap-3 rounded-lg border p-2.5">
              <ContactAvatar name={label} seed={participant.jid} size="sm" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{label}</p>{participant.name && participant.phone ? <p className="text-xs text-text-3">{formatPhone(participant.phone)}</p> : null}</div>
              {participant.admin && <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold text-brand-ink">{participant.admin === "superadmin" ? "Criador" : "Admin"}</span>}
            </li>;
          })}
          {!data?.selectedDetails?.participants.length && <li className="text-sm text-text-3">Nenhum participante disponível.</li>}
        </ul>
      </section>}
    </aside>}
  </div>;
}
