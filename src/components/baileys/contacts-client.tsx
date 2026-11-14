"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { formatPhone } from "@/lib/utils";

type Contact = { id: string; name: string | null; phone: string | null; remoteJid: string; isGroup: boolean; avatarUrl: string | null; participants: { jid: string }[] | null; unreadCount: number };

export function BaileysContactsClient() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/baileys/contacts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os contatos");
        return response.json() as Promise<{ contacts: Contact[] }>;
      })
      .then((data) => setContacts(data.contacts))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Erro ao carregar"));
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) => `${contact.name ?? ""} ${contact.phone ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [contacts, query]);

  return <div className="h-full overflow-y-auto p-4 md:p-6">
    <div className="mx-auto max-w-4xl space-y-5">
      <header><p className="kicker">Baileys</p><h1 className="font-serif text-3xl italic">Contatos</h1><p className="mt-1 text-sm text-text-3">Contatos e grupos sincronizados pelo WhatsApp Web.</p></header>
      <label className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2"><Search className="h-4 w-4 text-text-3"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label>
      {error && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger-text">{error}</p>}
      <div className="divide-y rounded-2xl border bg-background">
        {filtered.map((contact) => {
          const name = contact.name || contact.phone || (contact.isGroup ? "Grupo" : "Contato");
          return <Link href={`/baileys/inbox?chat=${encodeURIComponent(contact.id)}`} key={contact.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
            <ContactAvatar name={name} seed={contact.id} src={contact.avatarUrl}/><div className="min-w-0 flex-1"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-text-3">{contact.isGroup ? `Grupo do WhatsApp · ${contact.participants?.length ?? 0} participantes` : contact.phone ? formatPhone(contact.phone) : "WhatsApp"}</p></div>{contact.isGroup && <Users className="h-4 w-4 text-text-3"/>}{contact.unreadCount > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brand-fg">{contact.unreadCount}</span>}
          </Link>;
        })}
        {!error && filtered.length === 0 && <p className="p-8 text-center text-sm text-text-3">Nenhum contato encontrado.</p>}
      </div>
    </div>
  </div>;
}
