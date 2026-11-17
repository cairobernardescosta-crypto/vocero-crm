"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { formatPhone } from "@/lib/utils";

type Contact = { id: string; name: string | null; phone: string | null; remoteJid: string; isGroup: boolean; avatarUrl: string | null; participants: { jid: string }[] | null; unreadCount: number };

export function BaileysContactsClient() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null);
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      void fetch(`/api/baileys/contacts${params.size ? `?${params}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os contatos");
        return response.json() as Promise<{ contacts: Contact[]; nextCursor: string | null }>;
      })
      .then((data) => { setContacts(data.contacts); setNextCursor(data.nextCursor); })
      .catch((reason: unknown) => { if ((reason as Error)?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Erro ao carregar"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, reloadToken]);
  useEffect(() => {
    const source = new EventSource("/api/events");
    const refresh = () => setReloadToken((value) => value + 1);
    source.addEventListener("baileys.updated", refresh);
    return () => source.close();
  }, []);

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true); setError(null);
    const params = new URLSearchParams({ cursor: nextCursor });
    if (query.trim()) params.set("q", query.trim());
    try {
      const response = await fetch(`/api/baileys/contacts?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar mais contatos");
      const data = await response.json() as { contacts: Contact[]; nextCursor: string | null };
      setContacts((previous) => [...previous, ...data.contacts]);
      setNextCursor(data.nextCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar"); }
    finally { setLoading(false); }
  }

  return <div className="h-full overflow-y-auto p-4 md:p-6">
    <div className="mx-auto max-w-4xl space-y-5">
      <header><p className="kicker">Baileys</p><h1 className="font-serif text-3xl italic">Contatos</h1><p className="mt-1 text-sm text-text-3">Contatos e grupos sincronizados pelo WhatsApp Web.</p></header>
      <label className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2"><Search className="h-4 w-4 text-text-3"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label>
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft p-3 text-sm text-danger-text"><span>{error}</span><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="rounded-md border border-current px-2 py-1 font-semibold">Tentar novamente</button></div>}
      <div className="divide-y rounded-2xl border bg-background">
        {contacts.map((contact) => {
          const name = contact.name || contact.phone || (contact.isGroup ? "Grupo" : "Contato");
          return <Link href={`/baileys/inbox?chat=${encodeURIComponent(contact.id)}`} key={contact.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
            <ContactAvatar name={name} seed={contact.id} src={contact.avatarUrl}/><div className="min-w-0 flex-1"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-text-3">{contact.isGroup ? `Grupo do WhatsApp · ${contact.participants?.length ?? 0} participantes` : contact.phone ? formatPhone(contact.phone) : "WhatsApp"}</p></div>{contact.isGroup && <Users className="h-4 w-4 text-text-3"/>}{contact.unreadCount > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brand-fg">{contact.unreadCount}</span>}
          </Link>;
        })}
        {!error && !loading && contacts.length === 0 && <p className="p-8 text-center text-sm text-text-3">Nenhum contato encontrado.</p>}
      </div>
      {nextCursor && <button type="button" disabled={loading} onClick={() => void loadMore()} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">{loading ? "Carregando…" : "Carregar mais contatos"}</button>}
    </div>
  </div>;
}
