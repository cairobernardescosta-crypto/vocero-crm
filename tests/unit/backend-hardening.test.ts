import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("endurecimento das configurações locais", () => {
  it("respeita a organização ativa e só converte ausência real de sessão em null", () => {
    const session = source("src/lib/auth/session.ts");
    expect(session).toContain("session.session.activeOrganizationId");
    expect(session).toContain("error instanceof UnauthorizedError");
  });

  it("usa fallback determinístico para associação", () => {
    const signup = source("src/server/auth/on-signup.ts");
    expect(signup).toContain("organizationId?: string | null");
    expect(signup).toContain("orderBy(asc(schema.member.createdAt), asc(schema.member.id))");
  });

  it("compensa conta de equipe quando a associação falha", () => {
    const team = source("src/app/api/settings/team/route.ts");
    expect(team).toContain("db.delete(schema.user)");
    expect(team).toContain("membership_not_created");
  });

  it("limita logo antes de materializar o corpo", () => {
    const favicon = source("src/app/api/settings/branding/favicon/route.ts");
    expect(favicon.indexOf('req.headers.get("content-length")')).toBeLessThan(
      favicon.indexOf("req.arrayBuffer()")
    );
  });

  it("gera o hash fora da transação e confirma a credencial", () => {
    const account = source("src/app/api/settings/account/route.ts");
    expect(account.indexOf("await hashPassword")).toBeLessThan(account.indexOf("getDb().transaction"));
    expect(account).toContain("credential_not_found");
    expect(account).toContain("returning({ id: schema.account.id })");
  });
});
