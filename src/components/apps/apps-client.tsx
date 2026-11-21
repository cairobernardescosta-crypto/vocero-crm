"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, LoaderCircle, Mail, Megaphone, Plug, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Tab = "exports" | "email" | "meta" | "tiktok" | "integrations" | "campaigns";
type Format = "contacts" | "pipeline" | "generic" | "brevo" | "mailchimp" | "meta" | "tiktok";
type Column = "name" | "phone" | "email" | "address" | "city" | "neighborhood" | "source" | "stage" | "lastInteraction" | "consent";
type PreviewContact = { key: string; name: string; phone: string | null; email: string | null; source: "api" | "baileys"; stageName: string | null; consent: "opt_in" | "opt_out" | null };
type Campaign = { id: string; name: string; platform: string; startsAt: string | null; endsAt: string | null; investmentCents: number | null; reach: number | null; impressions: number | null; clicks: number | null; leads: number | null; conversions: number | null; revenueCents: number | null };

const tabs: { id: Tab; label: string; icon: typeof Download }[] = [
  { id: "exports", label: "Exportações", icon: Download },
  { id: "email", label: "E-mail Marketing", icon: Mail },
  { id: "meta", label: "Meta Ads", icon: Megaphone },
  { id: "tiktok", label: "TikTok Ads", icon: Megaphone },
  { id: "integrations", label: "Integrações API", icon: Plug },
  { id: "campaigns", label: "Resultados", icon: BarChart3 },
];

const columnOptions: { id: Column; label: string }[] = [
  { id: "name", label: "Nome" }, { id: "phone", label: "Telefone" }, { id: "email", label: "E-mail" },
  { id: "address", label: "Endereço" }, { id: "city", label: "Cidade" }, { id: "neighborhood", label: "Bairro" },
  { id: "source", label: "Conexão" }, { id: "stage", label: "Etapa" }, { id: "lastInteraction", label: "Última interação" },
  { id: "consent", label: "Consentimento" },
];

function formatMoney(cents: number | null): string { return cents == null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export function AppsClient({ initialSource }: { initialSource: "api" | "baileys" }) {
  const [tab, setTab] = useState<Tab>("exports");
  const [format, setFormat] = useState<Format>("contacts");
  const [source, setSource] = useState<string>(initialSource);
  const [query, setQuery] = useState("");
  const [columns, setColumns] = useState<Column[]>(["name", "phone", "email", "address", "city", "neighborhood"]);
  const [preview, setPreview] = useState<PreviewContact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [campaignPlatform, setCampaignPlatform] = useState("meta");
  const [campaignInvestment, setCampaignInvestment] = useState("");
  const [campaignLeads, setCampaignLeads] = useState("");
  const [campaignConversions, setCampaignConversions] = useState("");
  const [campaignRevenue, setCampaignRevenue] = useState("");

  const filters = useMemo(() => ({ q: query.trim() || undefined, source: source || undefined }), [query, source]);

  const loadPreview = useCallback(async (nextFormat = format) => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({ format: nextFormat });
    if (filters.q) params.set("q", filters.q);
    if (filters.source) params.set("source", filters.source);
    try {
      const response = await fetch(`/api/apps/preview?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { contacts?: PreviewContact[]; total?: number; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "Não foi possível preparar a exportação");
      setPreview(body?.contacts ?? []); setTotal(body?.total ?? body?.contacts?.length ?? 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível preparar a exportação"); }
    finally { setLoading(false); }
  }, [filters, format]);

  const loadCampaigns = useCallback(async () => {
    try {
      const response = await fetch("/api/apps/campaigns", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body = await response.json() as { campaigns?: Campaign[] };
      setCampaigns(body.campaigns ?? []);
    } catch { setError("Não foi possível carregar os resultados de campanhas"); }
  }, []);

  useEffect(() => { if (tab !== "campaigns") void loadPreview(); else void loadCampaigns(); }, [loadCampaigns, loadPreview, tab]);

  function chooseFormat(next: Format, nextTab: Tab) { setFormat(next); setTab(nextTab); setPreview([]); setTotal(0); }

  async function exportCsv() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/apps/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format, filters, columns }) });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(body?.error?.message || "Não foi possível exportar"); }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = href; link.download = `crm-${format}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(href);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível exportar"); }
    finally { setLoading(false); }
  }

  async function saveCampaign() {
    if (!campaignName.trim()) return;
    setLoading(true); setError(null);
    const money = (value: string) => value ? Math.round(Number(value.replace(".", "").replace(",", ".")) * 100) : null;
    try {
      const response = await fetch("/api/apps/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: campaignName, platform: campaignPlatform, investmentCents: money(campaignInvestment), leads: campaignLeads ? Number(campaignLeads) : null, conversions: campaignConversions ? Number(campaignConversions) : null, revenueCents: money(campaignRevenue) }) });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "Não foi possível salvar a campanha");
      setCampaignName(""); setCampaignInvestment(""); setCampaignLeads(""); setCampaignConversions(""); setCampaignRevenue(""); await loadCampaigns();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a campanha"); }
    finally { setLoading(false); }
  }

  const metrics = useMemo(() => campaigns.reduce((sum, item) => ({ investment: sum.investment + (item.investmentCents ?? 0), leads: sum.leads + (item.leads ?? 0), conversions: sum.conversions + (item.conversions ?? 0), revenue: sum.revenue + (item.revenueCents ?? 0) }), { investment: 0, leads: 0, conversions: 0, revenue: 0 }), [campaigns]);

  return <div className="flex h-full flex-col">
    <header className="border-b px-4 py-3 sm:px-6 sm:py-4"><h1 className="text-[17px] font-bold">Apps</h1><p className="mt-1 text-sm text-text-3">Exportações, integrações opcionais e resultados de campanhas.</p></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <nav aria-label="Funções de Apps" className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold", tab === item.id ? "border-brand bg-brand-tint text-brand-text" : "border-border-strong hover:bg-accent")}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
      {tab === "campaigns" ? <CampaignsPanel campaigns={campaigns} metrics={metrics} fields={{ campaignName, campaignPlatform, campaignInvestment, campaignLeads, campaignConversions, campaignRevenue }} setters={{ setCampaignName, setCampaignPlatform, setCampaignInvestment, setCampaignLeads, setCampaignConversions, setCampaignRevenue }} saving={loading} onSave={() => void saveCampaign()} /> : tab === "integrations" ? <IntegrationsPanel /> : <ExportPanel tab={tab} format={format} source={source} query={query} columns={columns} preview={preview} total={total} loading={loading} onFormat={(value) => setFormat(value)} onSource={setSource} onQuery={setQuery} onColumns={setColumns} onRefresh={() => void loadPreview()} onExport={() => void exportCsv()} onChoose={chooseFormat} />}
      {error && <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    </div>
  </div>;
}

function ExportPanel({ tab, format, source, query, columns, preview, total, loading, onFormat, onSource, onQuery, onColumns, onRefresh, onExport, onChoose }: { tab: Exclude<Tab, "integrations" | "campaigns">; format: Format; source: string; query: string; columns: Column[]; preview: PreviewContact[]; total: number; loading: boolean; onFormat: (value: Format) => void; onSource: (value: string) => void; onQuery: (value: string) => void; onColumns: (value: Column[]) => void; onRefresh: () => void; onExport: () => void; onChoose: (format: Format, tab: Tab) => void }) {
  const info = tab === "email" ? { title: "E-mail Marketing", description: "Exporte somente contatos com consentimento explícito e e-mail cadastrado.", formats: ["brevo", "mailchimp"] as Format[] } : tab === "meta" ? { title: "Meta Ads", description: "Gere um CSV para importação manual de público personalizado. Nenhum dado é enviado à Meta.", formats: ["meta"] as Format[] } : tab === "tiktok" ? { title: "TikTok Ads", description: "Gere um CSV para importação manual. Nenhum dado é enviado ao TikTok.", formats: ["tiktok"] as Format[] } : { title: "Exportações", description: "Escolha filtros e colunas sem alterar os contatos originais.", formats: ["contacts", "pipeline", "generic"] as Format[] };
  return <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"><Card><CardHeader><CardTitle>{info.title}</CardTitle><CardDescription>{info.description}</CardDescription></CardHeader><CardContent className="space-y-4">
    <div className="space-y-1.5"><Label htmlFor="apps-format">Formato</Label><select id="apps-format" value={info.formats.includes(format) ? format : info.formats[0]} onChange={(event) => onFormat(event.target.value as Format)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{info.formats.map((item) => <option key={item} value={item}>{({ contacts: "Contatos gerais", pipeline: "Pipeline", generic: "CSV genérico", brevo: "Brevo", mailchimp: "Mailchimp", meta: "Meta Ads", tiktok: "TikTok Ads" } as Record<Format, string>)[item]}</option>)}</select></div>
    <div className="space-y-1.5"><Label htmlFor="apps-search">Pesquisar</Label><Input id="apps-search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Nome, telefone ou e-mail" /></div>
    <div className="space-y-1.5"><Label htmlFor="apps-source">Modelo de conexão</Label><select id="apps-source" value={source} onChange={(event) => onSource(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">API e Baileys</option><option value="api">API</option><option value="baileys">Baileys</option></select></div>
    <fieldset><legend className="text-sm font-medium">Colunas</legend><div className="mt-2 grid grid-cols-2 gap-2">{columnOptions.map((item) => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={columns.includes(item.id)} onChange={(event) => onColumns(event.target.checked ? [...columns, item.id] : columns.filter((column) => column !== item.id))} />{item.label}</label>)}</div></fieldset>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading} onClick={onRefresh}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}Atualizar prévia</Button><Button disabled={loading || total === 0 || columns.length === 0} onClick={onExport}><Download className="h-4 w-4" />Exportar {total}</Button></div>
    {(tab === "email" || tab === "meta" || tab === "tiktok") && <p className="rounded-md bg-subtle p-3 text-xs text-text-3">Os formatos de marketing incluem somente contatos marcados com consentimento. Sem consentimento explícito, a exportação ficará vazia.</p>}
  </CardContent></Card><Card><CardHeader><CardTitle>Prévia</CardTitle><CardDescription>{total} registro(s) elegível(is) para o formato selecionado.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="border-b text-text-3"><tr><th className="py-2 pr-3">Contato</th><th className="py-2 pr-3">Telefone</th><th className="py-2 pr-3">E-mail</th><th className="py-2 pr-3">Fonte</th><th className="py-2">Etapa</th></tr></thead><tbody>{preview.slice(0, 20).map((contact) => <tr key={contact.key} className="border-b"><td className="py-2 pr-3 font-medium">{contact.name}</td><td className="py-2 pr-3 font-mono">{contact.phone || "—"}</td><td className="py-2 pr-3">{contact.email || "—"}</td><td className="py-2 pr-3">{contact.source === "baileys" ? "Baileys" : "API"}</td><td className="py-2">{contact.stageName || "Sem etapa"}</td></tr>)}</tbody></table>{!preview.length && !loading && <p className="py-8 text-center text-sm text-text-3">Nenhum contato elegível com os filtros atuais.</p>}</div></CardContent></Card>
    {tab === "exports" && <div className="xl:col-span-2 grid gap-3 sm:grid-cols-3"><QuickExport title="E-mail Marketing" text="Brevo ou Mailchimp por CSV manual." onClick={() => onChoose("brevo", "email")} /><QuickExport title="Meta Ads" text="Público personalizado por CSV." onClick={() => onChoose("meta", "meta")} /><QuickExport title="TikTok Ads" text="Público personalizado por CSV." onClick={() => onChoose("tiktok", "tiktok")} /></div>}
  </div>;
}

function QuickExport({ title, text, onClick }: { title: string; text: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="rounded-lg border bg-card p-4 text-left hover:bg-accent"><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-text-3">{text}</p></button>; }

function IntegrationsPanel() { return <div className="grid gap-4 md:grid-cols-2"><IntegrationCard name="Brevo" /><IntegrationCard name="Mailchimp" /><IntegrationCard name="Meta Ads" exportOnly /><IntegrationCard name="TikTok Ads" exportOnly /></div>; }
function IntegrationCard({ name, exportOnly = false }: { name: string; exportOnly?: boolean }) { return <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>{name}</CardTitle><span className="rounded-full bg-subtle px-2 py-1 text-xs font-semibold text-text-3">Não configurado</span></div><CardDescription>{exportOnly ? "Disponível atualmente por exportação manual de CSV." : "A integração por API é opcional e permanece desativada até receber credenciais."}</CardDescription></CardHeader><CardContent><div className="rounded-md border bg-subtle p-3 text-sm"><p className="font-medium">Modo manual disponível</p><p className="mt-1 text-text-3">Use a área de exportações para gerar o arquivo. Nenhum contato é enviado automaticamente.</p></div><Button className="mt-4" variant="outline" disabled><Plug className="h-4 w-4" />Configurar API</Button></CardContent></Card>; }

function CampaignsPanel({ campaigns, metrics, fields, setters, saving, onSave }: { campaigns: Campaign[]; metrics: { investment: number; leads: number; conversions: number; revenue: number }; fields: { campaignName: string; campaignPlatform: string; campaignInvestment: string; campaignLeads: string; campaignConversions: string; campaignRevenue: string }; setters: { setCampaignName: (value: string) => void; setCampaignPlatform: (value: string) => void; setCampaignInvestment: (value: string) => void; setCampaignLeads: (value: string) => void; setCampaignConversions: (value: string) => void; setCampaignRevenue: (value: string) => void }; saving: boolean; onSave: () => void }) {
  const cards = [{ label: "Investimento", value: formatMoney(metrics.investment) }, { label: "Leads", value: String(metrics.leads) }, { label: "Conversões", value: String(metrics.conversions) }, { label: "Receita informada", value: formatMoney(metrics.revenue) }];
  return <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <div key={card.label} className="rounded-lg border bg-subtle p-4"><p className="text-sm text-text-3">{card.label}</p><p className="mt-1 text-2xl font-semibold">{card.value}</p></div>)}</div><div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"><Card><CardHeader><CardTitle>Cadastrar resultado</CardTitle><CardDescription>Registro manual, separado dos dados comerciais do CRM.</CardDescription></CardHeader><CardContent className="space-y-3"><div><Label htmlFor="campaign-name">Campanha</Label><Input id="campaign-name" value={fields.campaignName} onChange={(event) => setters.setCampaignName(event.target.value)} /></div><div><Label htmlFor="campaign-platform">Plataforma</Label><select id="campaign-platform" value={fields.campaignPlatform} onChange={(event) => setters.setCampaignPlatform(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="meta">Meta</option><option value="tiktok">TikTok</option><option value="email">E-mail</option><option value="other">Outra</option></select></div><div className="grid grid-cols-2 gap-2"><Field label="Investimento (R$)" value={fields.campaignInvestment} set={setters.setCampaignInvestment} /><Field label="Receita (R$)" value={fields.campaignRevenue} set={setters.setCampaignRevenue} /><Field label="Leads" value={fields.campaignLeads} set={setters.setCampaignLeads} integer /><Field label="Conversões" value={fields.campaignConversions} set={setters.setCampaignConversions} integer /></div><Button disabled={saving || !fields.campaignName.trim()} onClick={onSave}>{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Salvar resultado</Button></CardContent></Card><Card><CardHeader><CardTitle>Campanhas registradas</CardTitle><CardDescription>Comparação simples dos resultados informados manualmente.</CardDescription></CardHeader><CardContent><CampaignChart campaigns={campaigns} /><div className="mt-5 space-y-3">{campaigns.map((item) => <div key={item.id} className="rounded-md border p-3"><div className="flex items-center justify-between gap-3"><p className="font-semibold">{item.name}</p><span className="rounded-full bg-brand-tint px-2 py-1 text-xs font-semibold text-brand-text">{item.platform}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Metric label="Investimento" value={formatMoney(item.investmentCents)} /><Metric label="Leads" value={String(item.leads ?? 0)} /><Metric label="Conversões" value={String(item.conversions ?? 0)} /><Metric label="Receita" value={formatMoney(item.revenueCents)} /></div></div>)}{!campaigns.length && <p className="py-8 text-center text-sm text-text-3">Nenhum resultado cadastrado.</p>}</div></CardContent></Card></div></div>;
}
function CampaignChart({ campaigns }: { campaigns: Campaign[] }) {
  const visible = campaigns.slice(0, 6);
  const maximum = Math.max(1, ...visible.map((campaign) => campaign.leads ?? 0));
  if (!visible.length) return null;
  return <div aria-label="Gráfico de leads por campanha" className="space-y-2 rounded-md border bg-subtle p-3">{visible.map((campaign) => <div key={campaign.id} className="grid grid-cols-[minmax(90px,1fr)_2fr_36px] items-center gap-2 text-xs"><span className="truncate" title={campaign.name}>{campaign.name}</span><div className="h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-brand" style={{ width: `${((campaign.leads ?? 0) / maximum) * 100}%` }} /></div><span className="text-right tabular-nums">{campaign.leads ?? 0}</span></div>)}</div>;
}
function Field({ label, value, set, integer = false }: { label: string; value: string; set: (value: string) => void; integer?: boolean }) { return <label className="text-sm"><span className="font-medium">{label}</span><Input value={value} inputMode={integer ? "numeric" : "decimal"} onChange={(event) => set(event.target.value.replace(integer ? /\D/g : /[^\d,.]/g, ""))} className="mt-1" /></label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-text-3">{label}</p><p className="font-medium">{value}</p></div>; }
