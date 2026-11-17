"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/baileys/settings", label: "WhatsApp Baileys" },
  { href: "/baileys/settings/account", label: "Meu usuário" },
  { href: "/baileys/settings/branding", label: "Marca" },
  { href: "/baileys/settings/appearance", label: "Aparência" },
  { href: "/baileys/settings/quick-replies", label: "Respostas rápidas" },
  { href: "/baileys/settings/team", label: "Equipe" },
];

export function BaileysSettingsNav() {
  const pathname = usePathname();
  return <nav aria-label="Configurações Baileys" className="flex shrink-0 gap-1 overflow-x-auto border-b p-3 sm:w-52 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
    <span className="kicker mb-1 px-3">Baileys</span>
    {links.map((link) => {
      const active = pathname === link.href;
      return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={cn("shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold", active ? "bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent")}>{link.label}</Link>;
    })}
  </nav>;
}
