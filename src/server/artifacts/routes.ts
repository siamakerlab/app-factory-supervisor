import type { FastifyInstance } from "fastify";

import type { ArtifactService } from "./service.js";

export function registerArtifactRoutes(
  server: FastifyInstance,
  artifactService: ArtifactService
): void {
  server.get<{ Querystring: { projectId?: string; limit?: string } }>(
    "/api/artifacts",
    async (request) => ({
      artifacts: await artifactService.listRecent({
        ...(request.query.projectId ? { projectId: request.query.projectId } : {}),
        ...(request.query.limit ? { limit: Number(request.query.limit) } : {})
      })
    })
  );

  server.get<{ Params: { artifactId: string } }>(
    "/api/artifacts/:artifactId",
    async (request, reply) => {
      const artifact = await artifactService.getArtifact(request.params.artifactId);
      if (!artifact) {
        return reply.code(404).send({
          error: "artifact_not_found"
        });
      }
      return artifact;
    }
  );

  server.get<{ Params: { artifactId: string } }>(
    "/api/artifacts/:artifactId/content",
    async (request, reply) => {
      try {
        const content = await artifactService.openContent(request.params.artifactId);
        if (!content) {
          return reply.code(404).send({
            error: "artifact_content_unavailable"
          });
        }
        reply.header("content-disposition", `attachment; filename="${content.filename}"`);
        reply.header("x-artifact-sha256", content.artifact.sha256 ?? "");
        reply.header("x-artifact-type", content.artifact.artifactType);
        return reply.send(content.stream);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "artifact_hash_mismatch" ||
            error.message === "artifact_path_outside_allowed_roots")
        ) {
          return reply.code(409).send({
            error: error.message
          });
        }
        throw error;
      }
    }
  );
}
