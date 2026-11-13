import { notFound } from "next/navigation";
import { BaileysResultsClient } from "@/components/baileys/results-client";
import { baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

export default function BaileysResultsPage() {
  if (!baileysEnabled()) notFound();
  return <BaileysResultsClient />;
}
