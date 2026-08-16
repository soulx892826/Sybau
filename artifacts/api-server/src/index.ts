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
  try {
    await checkDatabaseConnection();
    logger.info("Database connection verified");
  } catch (error: unknown) {
    logger.error(
      { error },
      "Database connection failed; refusing to start the bot",
    );
    process.exitCode = 1;
    return;
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    void startDiscordBot().catch((error: unknown) => {
      logger.error({ error }, "Discord bot failed to start");
    });
  });
}

void start();
