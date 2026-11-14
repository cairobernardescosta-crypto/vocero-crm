/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const {
      checkMediaDir,
      cleanupOrphanRuns,
      encryptLegacySecrets,
      resumeDispatch,
      resumeWebhooks,
    } = await import("./instrumentation-node");
    await checkMediaDir();
    await cleanupOrphanRuns();
    await encryptLegacySecrets();
    resumeDispatch();
    resumeWebhooks();

    const { baileysEnabled } = await import("@/server/baileys/flag");
    if (baileysEnabled()) {
      const { recoverBaileysConnections } = await import("@/server/baileys/connector");
      void recoverBaileysConnections().catch((error: unknown) => {
        console.error(
          "[baileys] falha ao recuperar conexões:",
          error instanceof Error ? error.message : "erro"
        );
      });
    }
  }
}
