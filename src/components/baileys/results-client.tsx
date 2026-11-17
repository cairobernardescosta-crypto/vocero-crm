"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, MessageCircleMore, Users, MailOpen } from "lucide-react";

type Results = { conversations: number; groups: number; incoming: number; outgoing: number; unread: number };

export function BaileysResultsClient() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    setError(null);
    void fetch("/api/baileys/results", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os resultados");
        return response.json() as Promise<Results>;
      })
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Erro ao carregar"));
  }, [reloadToken]);
  useEffect(() => {
    const source = new EventSource("/api/events");
    const refresh = () => setReloadToken((value) => value + 1);
    source.addEventListener("baileys.updated", refresh);
    return () => source.close();
  }, []);
  const cards = [
    ["Conversas", data?.conversations, MessageCircleMore], ["Grupos", data?.groups, Users],
    ["Recebidas", data?.incoming, ArrowDownLeft], ["Enviadas", data?.outgoing, ArrowUpRight], ["Não lidas", data?.unread, MailOpen],
  ] as const;
  return <div className="h-full overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-5xl space-y-6">
    <header><p className="kicker">Baileys</p><h1 className="font-serif text-3xl italic">Resultados</h1><p className="mt-1 text-sm text-text-3">Dados exclusivos do WhatsApp Web, sem misturar com a API oficial.</p></header>
    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft p-3 text-sm text-danger-text"><span>{error}</span><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="rounded-md border border-current px-2 py-1 font-semibold">Tentar novamente</button></div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, value, Icon]) => <section key={label} className="rounded-2xl border bg-background p-5"><Icon className="h-5 w-5 text-brand"/><p className="mt-5 text-3xl font-bold tabular-nums">{value ?? "—"}</p><p className="mt-1 text-sm text-text-3">{label}</p></section>)}</div>
  </div></div>;
}
