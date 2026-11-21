import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

const createSchema = z.object({ name: z.string().trim().min(1).max(80), filters: z.record(z.string(), z.unknown()) });
export const GET = withAuth(async (session) => Response.json({ segments: await getDb().select().from(schema.mapSavedSegment).where(eq(schema.mapSavedSegment.organizationId, session.organizationId)).orderBy(desc(schema.mapSavedSegment.updatedAt)) }));
export const POST = withAuth(async (session, req: Request) => { const body = await parseBody(req, createSchema); if (!body.ok) return body.response; const [segment] = await getDb().insert(schema.mapSavedSegment).values({ id: newId("mapSavedSegment"), organizationId: session.organizationId, ...body.data }).returning(); return Response.json({ segment }, { status: 201 }); });
