import { notFound, redirect } from "next/navigation";
import { baileysEnabled } from "@/server/baileys/flag";

export const dynamic = "force-dynamic";

export default function BaileysPage() {
  if (!baileysEnabled()) notFound();
  redirect("/baileys/inbox");
}
