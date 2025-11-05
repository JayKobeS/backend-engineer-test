import type { FastifyInstance } from "fastify";

export async function registerRootRoutes(app: FastifyInstance) {
  app.get('/', async (_request, _reply) => {
    return { welcome: 'in blockchain' };
  });
}
