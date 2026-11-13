import { notFound } from "next/navigation";
import { BaileysClient } from "@/components/baileys/baileys-client";
import { baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

export default function BaileysInboxPage() {
  if (!baileysEnabled()) notFound();
  return <BaileysClient />;
}
