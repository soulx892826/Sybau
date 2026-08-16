import app from "./app";
import { startDiscordBot } from "./discord/bot";
import { logger } from "./lib/logger";
import { checkDatabaseConnection } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");

    void startServices().catch((error: unknown) => {
      logger.error({ error }, "Background services failed to start");
    });
  });

  server.on("error", (error: unknown) => {
    logger.error({ error }, "Error listening on port");
    process.exit(1);
  });
}

async function startServices(): Promise<void> {
  if (!process.env["DISCORD_BOT_TOKEN"]) {
    logger.warn("DISCORD_BOT_TOKEN is not configured; Discord bot is disabled");
    return;
  }

  if (!process.env["DATABASE_URL"]) {
    logger.error("DATABASE_URL is not configured; Discord bot is disabled");
    return;
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      await checkDatabaseConnection();
      logger.info("Database connection verified");
      break;
    } catch (error: unknown) {
      logger.warn(
        { error, attempt },
        "Database is not ready; retrying bot startup",
      );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(30_000, attempt * 2_000)),
      );
    }
  }

  await startDiscordBot();
}

void start();
