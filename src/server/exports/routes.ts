import type { FastifyInstance } from "fastify";

import type { ProjectExportService } from "./service.js";

export function registerProjectExportRoutes(
  server: FastifyInstance,
  projectExportService: ProjectExportService
): void {
  server.get<{ Querystring: { limit?: string } }>("/api/project-exports", async (request) => ({
    exports: await projectExportService.listRecentExports(
      request.query.limit ? Number(request.query.limit) : undefined
    )
  }));

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/exports",
    async (request) => ({
      exports: await projectExportService.listProjectExports(request.params.projectId)
    })
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/exports",
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await projectExportService.requestFullExport(
              request.params.projectId,
              request.sessionUser?.userId ?? null
            )
          );
      } catch (error) {
        if (error instanceof Error && error.message === "project_not_found") {
          return reply.code(404).send({
            error: "project_not_found"
          });
        }
        throw error;
      }
    }
  );

  server.get<{ Params: { exportId: string } }>(
    "/api/project-exports/:exportId",
    async (request, reply) => {
      const exportRecord = await projectExportService.getExport(request.params.exportId);
      if (!exportRecord) {
        return reply.code(404).send({
          error: "project_export_not_found"
        });
      }
      return exportRecord;
    }
  );

  server.get<{ Params: { exportId: string } }>(
    "/api/project-exports/:exportId/download",
    async (request, reply) => {
      try {
        const content = await projectExportService.openExportContent(request.params.exportId);
        if (!content) {
          return reply.code(404).send({
            error: "project_export_unavailable"
          });
        }
        reply.header("content-disposition", `attachment; filename="${content.filename}"`);
        reply.header("x-project-export-sha256", content.exportRecord.sha256 ?? "");
        return reply.send(content.stream);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "project_export_hash_mismatch" ||
            error.message === "project_export_artifact_outside_data")
        ) {
          return reply.code(409).send({
            error: error.message
          });
        }
        throw error;
      }
    }
  );

  server.delete<{ Params: { exportId: string } }>(
    "/api/project-exports/:exportId",
    async (request, reply) => {
      const exportRecord = await projectExportService.deleteExport(request.params.exportId);
      if (!exportRecord) {
        return reply.code(404).send({
          error: "project_export_not_found"
        });
      }
      return exportRecord;
    }
  );
}
