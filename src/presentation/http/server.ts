import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import { createAppContainer } from "../../infrastructure/di/container.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = path.resolve(__dirname, "ui/index.html");

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

const container = createAppContainer();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const method = req.method || "GET";

  try {
    if (method === "GET" && url.pathname === "/") {
      const html = fs.readFileSync(UI_HTML_PATH, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, container.getEnvStatus());
      return;
    }

    if (method === "GET" && url.pathname === "/api/profile") {
      sendJson(res, 200, container.manageProfileUseCase.getProfile());
      return;
    }

    if (method === "PUT" && url.pathname === "/api/profile") {
      const body = (await readJsonBody(req)) as ProfileConfig;
      const saved = container.manageProfileUseCase.updateProfile(body);
      sendJson(res, 200, saved);
      return;
    }

    if (method === "GET" && url.pathname === "/api/results") {
      const latest = container.manageProfileUseCase.getLatestResults();
      sendJson(res, 200, latest ?? { results: [] });
      return;
    }

    if (method === "POST" && url.pathname === "/api/search") {
      const body = (await readJsonBody(req)) as {
        dryRun?: boolean;
        ignoreSeen?: boolean;
        notifyTelegram?: boolean;
      };
      const summary = await container.huntJobsUseCase.execute({
        dryRun: body.dryRun ?? true,
        ignoreSeen: body.ignoreSeen ?? true,
        notifyTelegram: body.notifyTelegram ?? false,
      });
      sendJson(res, 200, summary);
      return;
    }

    if (method === "POST" && url.pathname === "/api/notify") {
      const body = (await readJsonBody(req)) as { mode?: "test" | "latest" };

      if (body.mode === "test") {
        const result = await container.testNotificationUseCase.sendTest();
        sendJson(res, 200, result);
        return;
      }

      const result = await container.testNotificationUseCase.resendLatestQualified();
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "Ruta no encontrada" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message });
  }
});

const port = Number(process.env.PORT || 3456);
server.listen(port, () => {
  console.log(`🌐 AI Job Hunter Panel disponible en http://localhost:${port}`);
});
