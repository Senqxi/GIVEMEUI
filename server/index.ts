import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { formatCommand } from "../src/lib/commandLine";
import { discoverCommand } from "./discovery";
import { runCommand } from "./runner";
import { detectLocalAiProviders, suggestSchemaPatch, summarizeRunOutput } from "./ai";
import { getProjectDatabase } from "./projectDb";
import type { AiRunSummaryRequest, AiSettings } from "../src/lib/ai";
import type { DiscoveryRequest, RunRequest } from "../src/lib/schema";
import type { ToolManifest } from "../src/lib/schema";
import type { WorkspaceState } from "../src/lib/storage";

const STATIC_DIR = process.env.GIVEMEUI_STATIC_DIR;
const HOST = process.env.GIVEMEUI_HOST ?? "127.0.0.1";
const PORT = Number(process.env.GIVEMEUI_PORT ?? process.env.GIVEMEUI_API_PORT ?? (STATIC_DIR ? 5173 : 5174));

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/api/projects") {
      const database = await getProjectDatabase();
      sendJson(res, database.getSnapshot());
      return;
    }

    if (req.method === "POST" && req.url === "/api/workspace") {
      const body = await readJson<{ projectId?: string; workspace: WorkspaceState }>(req);
      const database = await getProjectDatabase();
      sendJson(res, database.saveWorkspace(body.workspace, body.projectId));
      return;
    }

    if (req.method === "POST" && req.url === "/api/projects") {
      const body = await readJson<{ name?: string }>(req);
      const database = await getProjectDatabase();
      sendJson(res, database.createProject(body.name ?? "New Project"));
      return;
    }

    if (req.method === "POST" && req.url === "/api/projects/select") {
      const body = await readJson<{ projectId: string }>(req);
      const database = await getProjectDatabase();
      sendJson(res, database.selectProject(body.projectId));
      return;
    }

    if (req.method === "POST" && req.url === "/api/projects/delete") {
      const body = await readJson<{ projectId: string }>(req);
      const database = await getProjectDatabase();
      sendJson(res, database.deleteProject(body.projectId));
      return;
    }

    if (req.method === "POST" && req.url === "/api/projects/export") {
      const body = await readJson<{ projectId?: string }>(req);
      const database = await getProjectDatabase();
      sendJson(res, database.exportProject(body.projectId));
      return;
    }

    if (req.method === "POST" && req.url === "/api/projects/cleanup") {
      const body = await readJson<{ projectId?: string }>(req);
      const database = await getProjectDatabase();
      sendJson(res, database.cleanupProject(body.projectId));
      return;
    }

    if (req.method === "POST" && req.url === "/api/discover") {
      const body = await readJson<DiscoveryRequest>(req);
      const result = await discoverCommand(body);
      sendJson(res, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/run") {
      const body = await readJson<RunRequest>(req);
      await runCommand(body, req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/api/ai/detect") {
      const result = await detectLocalAiProviders();
      sendJson(res, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/summarize-run") {
      const body = await readJson<AiRunSummaryRequest>(req);
      const result = await summarizeRunOutput(body);
      sendJson(res, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/suggest-schema") {
      const body = await readJson<{ settings: AiSettings; manifest: ToolManifest }>(req);
      const result = await suggestSchemaPatch(body.settings, body.manifest);
      sendJson(res, result);
      return;
    }

    if (STATIC_DIR && serveStatic(req, res, STATIC_DIR)) {
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`GIVEMEUI listening on http://${HOST}:${PORT}`);
});

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}") as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function serveStatic(req: IncomingMessage, res: ServerResponse, staticDir: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const pathname = safeDecode((req.url ?? "/").split("?")[0] || "/");
  if (pathname.startsWith("/api/")) return false;

  const staticRoot = resolve(staticDir);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolveStaticPath(staticRoot, requestedPath) ?? resolveStaticPath(staticRoot, "/index.html");

  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return true;
  }

  const body = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable"
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

function resolveStaticPath(staticRoot: string, pathname: string): string | null {
  const normalizedPath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = resolve(join(staticRoot, normalizedPath));
  const rootRelative = relative(staticRoot, filePath);

  if (rootRelative.startsWith("..") || rootRelative === "" || resolve(rootRelative) === rootRelative) {
    return null;
  }

  try {
    const stat = statSync(filePath);
    if (stat.isFile()) return filePath;
  } catch {
    if (!extname(pathname)) {
      return resolveStaticPath(staticRoot, "/index.html");
    }
  }

  return null;
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "/";
  }
}

console.log(`GIVEMEUI command API ready. Discovery runs help commands like: ${formatCommand(["python3", "--help"])}`);
