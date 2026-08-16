import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkDatabaseConnection } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (req, res) => {
  try {
    await checkDatabaseConnection();
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error: unknown) {
    req.log.error({ error }, "Database health check failed");
    res.status(503).json({ status: "database-unavailable" });
  }
});

export default router;
