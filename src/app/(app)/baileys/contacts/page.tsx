import { notFound } from "next/navigation";
import { BaileysContactsClient } from "@/components/baileys/contacts-client";
import { baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

export default function BaileysContactsPage() {
  if (!baileysEnabled()) notFound();
  return <BaileysContactsClient />;
}
