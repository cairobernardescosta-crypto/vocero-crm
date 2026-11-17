"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, LoaderCircle, PlugZap, QrCode, RefreshCw, Unplug } from "lucide-react";
import { formatPhone } from "@/lib/utils";

type Snapshot = {
  connection: { status: string; phone: string | null; error: string | null; updatedAt?: string };
  qr: string | null;
  chats: unknown[];
  diagnostics?: { lastUpsertAt: string | null; lastUpsertType: string | null };
};

const STATUS: Record<string, string> = { disconnected: "Desconectado", waiting_qr: "Aguardando QR Code", connecting: "Conectando", connected: "Conectado", reconnecting: "Reconectando", error: "Erro" };

export function BaileysSettingsClient() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/baileys", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar as configurações Baileys");
    setData(await response.json() as Snapshot);
    setError(null);
  }, []);
  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Falha ao carregar"));
    const timer = window.setInterval(() => void load().catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function action(actionName: "connect" | "disconnect") {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/baileys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName }) });
      if (!response.ok) throw new Error("Não foi possível alterar a conexão");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha na conexão"); }
    finally { setBusy(false); }
  }

  const connected = data?.connection.status === "connected";
  return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <div><p className="kicker">WhatsApp Web</p><h1 className="mt-1 text-2xl font-bold">Configurações Baileys</h1><p className="mt-1 text-sm text-text-2">Configurações exclusivas deste modo, sem credenciais da API Meta ou recursos de IA.</p></div>
    {error && <div role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger-text">{error}</div>}
    <section className="rounded-2xl border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="flex items-center gap-2 font-semibold"><PlugZap className="h-5 w-5" /> Conexão</h2><p className="mt-1 text-sm text-text-2">{STATUS[data?.connection.status ?? "disconnected"]}{data?.connection.phone ? ` · ${formatPhone(data.connection.phone)}` : ""}</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} className="rounded-lg border p-2" aria-label="Atualizar"><RefreshCw className="h-4 w-4" /></button>{connected ? <button disabled={busy} onClick={() => void action("disconnect")} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><Unplug className="h-4 w-4" />Desconectar</button> : <button disabled={busy} onClick={() => void action("connect")} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-fg">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}Conectar</button>}</div></div>
      {data?.qr && <div className="mt-5 flex flex-col items-center rounded-xl bg-subtle p-4"><Image unoptimized width={240} height={240} src={data.qr} alt="QR Code do WhatsApp" className="rounded-lg bg-white p-2" /><p className="mt-2 text-center text-sm text-text-2">Escaneie em WhatsApp → Aparelhos conectados.</p></div>}
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      <RuleCard title="Recebimento" items={["Somente mensagens novas", "Atualização ao vivo com verificação a cada 3 segundos", "Histórico antigo bloqueado"]} />
      <RuleCard title="Conversas" items={["Contato criado na primeira mensagem", "Grupos ignorados", "Nome, foto e telefone atualizados quando disponíveis"]} />
      <RuleCard title="Mídias" items={["Imagem, vídeo, áudio e documentos", "GIF e sticker animado", "Limites seguros de download"]} />
      <section className="rounded-2xl border bg-background p-5"><h2 className="font-semibold">Diagnóstico</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-text-3">Conversas locais</dt><dd className="font-semibold">{data?.chats.length ?? 0}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-3">Último evento</dt><dd className="text-right font-semibold">{data?.diagnostics?.lastUpsertAt ? new Date(data.diagnostics.lastUpsertAt).toLocaleString("pt-BR") : "Nenhum nesta execução"}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-3">Tipo do evento</dt><dd className="font-semibold">{data?.diagnostics?.lastUpsertType ?? "—"}</dd></div></dl></section>
    </div>
  </div>;
}

function RuleCard({ title, items }: { title: string; items: string[] }) {
  return <section className="rounded-2xl border bg-background p-5"><h2 className="font-semibold">{title}</h2><ul className="mt-3 space-y-2 text-sm">{items.map((item) => <li key={item} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-text" /><span>{item}</span></li>)}</ul></section>;
}
