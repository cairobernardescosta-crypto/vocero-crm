import { BaileysSettingsNav } from "@/components/baileys/settings-nav";

export default function BaileysSettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex h-full flex-col"><header className="border-b px-4 py-3 sm:px-6 sm:py-4"><h2 className="text-[17px] font-bold">Configurações Baileys</h2></header><div className="flex min-h-0 flex-1 flex-col sm:flex-row"><BaileysSettingsNav /><div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div></div></div>;
}
