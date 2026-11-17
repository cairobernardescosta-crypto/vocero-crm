import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Branding } from "@/lib/branding";
import { getEnv } from "@/lib/env";
import { faviconCacheKey } from "@/lib/favicon";

const MARKER = "VoceroCRMManaged=1";

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").trim().slice(0, 60) || "Vocero CRM";
}

/** Atualiza somente o atalho criado pelo próprio CRM; fora do Windows não faz nada. */
export async function syncDesktopShortcut(branding: Branding): Promise<boolean> {
  if (process.platform !== "win32" || !process.env.USERPROFILE) return false;
  const desktop = path.join(process.env.USERPROFILE, "Desktop");
  const baseUrl = getEnv().APP_BASE_URL.replace(/\/$/, "");
  const files = await readdir(desktop).catch(() => []);
  await Promise.all(files.filter((file) => file.toLowerCase().endsWith(".url")).map(async (file) => {
    const target = path.join(desktop, file);
    const content = await readFile(target, "utf8").catch(() => "");
    if (content.includes(MARKER)) await unlink(target).catch(() => undefined);
  }));
  const content = [
    "[InternetShortcut]",
    `URL=${baseUrl}/baileys/inbox`,
    `IconFile=${baseUrl}/api/branding/app-icon?size=192&v=${faviconCacheKey(branding)}`,
    "IconIndex=0",
    MARKER,
    "",
  ].join("\r\n");
  await writeFile(path.join(desktop, `${safeFileName(branding.name)}.url`), content, "utf8");
  return true;
}
