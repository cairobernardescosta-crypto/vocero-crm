import { MapsClient } from "@/components/maps/maps-client";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function MapsPage() {
  const mode = (await cookies()).get("vocero-modo-whatsapp")?.value === "baileys" ? "baileys" : "api";
  return <MapsClient initialSource={mode} />;
}
