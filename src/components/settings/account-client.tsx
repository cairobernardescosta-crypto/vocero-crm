"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccountData = { user: { name: string; email: string; image: string | null; phone: string | null }; role: string };

function validImageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function AccountClient() {
  const [data, setData] = useState<AccountData | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [image, setImage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    setError(null);
    void fetch("/api/settings/account", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Não foi possível carregar o usuário");
      const next = await response.json() as AccountData;
      setData(next); setName(next.user.name); setEmail(next.user.email); setPhone(next.user.phone ?? ""); setImage(next.user.image ?? "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o usuário"));
  }, [loadKey]);

  async function save() {
    setError(null); setMessage(null);
    if (password !== confirmation) { setError("A confirmação da senha não confere"); return; }
    setSaving(true);
    const response = await fetch("/api/settings/account", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, phone: phone.trim() || null, image: image.trim() || null, password: password || null }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null) as { error?: { message?: string } } | null;
    setSaving(false);
    if (!response?.ok) { setError(body?.error?.message ?? "Não foi possível salvar"); return; }
    setPassword(""); setConfirmation(""); setMessage("Usuário atualizado com sucesso");
  }

  if (!data && !error) return <p className="text-sm text-text-3">Carregando…</p>;
  if (!data) return <Card className="max-w-2xl"><CardHeader><CardTitle>Meu usuário</CardTitle><CardDescription>Não foi possível carregar seus dados.</CardDescription></CardHeader><CardContent><p role="alert" className="mb-3 text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setLoadKey((key) => key + 1)}>Tentar novamente</Button></CardContent></Card>;
  const imagePreview = validImageUrl(image);
  return <div className="max-w-2xl space-y-6">
    <Card><CardHeader><CardTitle>Meu usuário</CardTitle><CardDescription>Altere seus dados de acesso local ao CRM.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">{imagePreview ? <Image unoptimized src={imagePreview} alt="Foto do usuário" width={56} height={56} className="h-14 w-14 rounded-full border object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint font-semibold text-brand-text">{name.trim().charAt(0).toUpperCase() || "U"}</div>}<div className="min-w-0 flex-1"><Label htmlFor="account-image">URL da foto de perfil</Label><Input id="account-image" type="url" value={image} maxLength={1000} placeholder="https://..." onChange={(event) => setImage(event.target.value)} /></div></div>
        <div className="space-y-1.5"><Label htmlFor="account-name">Nome</Label><Input id="account-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="account-email">E-mail de acesso</Label><Input id="account-email" type="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="account-phone">Telefone</Label><Input id="account-phone" inputMode="tel" value={phone} maxLength={30} onChange={(event) => setPhone(event.target.value)} /></div>
        {data && <p className="text-xs text-text-3">Perfil atual: {data.role === "owner" ? "Proprietário" : data.role}</p>}
        <div className="border-t pt-4"><h3 className="text-sm font-semibold">Trocar senha</h3><p className="mt-1 text-xs text-text-3">Deixe os campos vazios para manter a senha atual.</p></div>
        <div className="relative space-y-1.5"><Label htmlFor="account-password">Nova senha</Label><Input id="account-password" type={showPassword ? "text" : "password"} value={password} maxLength={128} onChange={(event) => setPassword(event.target.value)} className="pr-10" /><button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword((value) => !value)} className="absolute bottom-2 right-3 text-text-3">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
        <div className="space-y-1.5"><Label htmlFor="account-confirmation">Confirmar nova senha</Label><Input id="account-confirmation" type={showPassword ? "text" : "password"} value={confirmation} maxLength={128} onChange={(event) => setConfirmation(event.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" aria-live="polite" className="text-sm text-success-text">{message}</p>}
        <Button disabled={saving || !name.trim() || !email.trim()} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar alterações"}</Button>
      </CardContent>
    </Card>
  </div>;
}
