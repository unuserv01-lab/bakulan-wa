import { env } from "@bakulan/config";
import { buildApp } from "./app.js";

const app = await buildApp();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
