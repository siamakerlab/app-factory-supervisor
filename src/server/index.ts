import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const server = await buildServer();

await server.listen({
  host: config.APP_HOST,
  port: config.APP_PORT
});
