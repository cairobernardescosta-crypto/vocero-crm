import { notFound } from "next/navigation";
import { BaileysSettingsClient } from "@/components/baileys/settings-client";
import { baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

export default function BaileysSettingsPage() {
  if (!baileysEnabled()) notFound();
  return <BaileysSettingsClient />;
}
