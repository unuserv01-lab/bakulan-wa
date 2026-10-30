import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERSONA_TEMPLATES } from "@bakulan/shared-types";
import { getOwnedTenantOrThrow } from "../../lib/tenant.js";
import { activatePersona, createPersona, deletePersona, listPersonas, updatePersona } from "./service.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  systemPrompt: z.string().trim().min(10).max(4000),
  aiProvider: z.enum(["deepseek", "qwen"]).optional(),
});
const updateSchema = createSchema.partial();
const idParam = z.object({ id: z.string().uuid() });

export default async function personaRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  app.get("/persona/templates", auth, async () => PERSONA_TEMPLATES);

  app.get("/persona", auth, async (req) => {
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    return listPersonas(tenant.id);
  });

  app.post("/persona", auth, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    reply.code(201).send(await createPersona(tenant.id, body));
  });

  app.patch("/persona/:id", auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    return updatePersona(tenant.id, id, body);
  });

  app.post("/persona/:id/activate", auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    return activatePersona(tenant.id, id);
  });

  app.delete("/persona/:id", auth, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const tenant = await getOwnedTenantOrThrow(app, req.user.userId);
    await deletePersona(tenant.id, id);
    reply.code(204).send();
  });
}
