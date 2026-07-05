import type { DiscoveryRequest, DiscoveryResponse, RunEvent, RunRequest } from "./schema";
import type { AiCompletion, AiProviderDetection, AiRunSummaryRequest, AiSchemaPatchResponse, AiSettings } from "./ai";
import type { ToolManifest } from "./schema";

export async function discoverTool(request: DiscoveryRequest): Promise<DiscoveryResponse> {
  const response = await fetch("/api/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<DiscoveryResponse>;
}

export async function runCommandStream(
  request: RunRequest,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as RunEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as RunEvent);
  }
}

export async function detectAiProviders(): Promise<AiProviderDetection[]> {
  const response = await fetch("/api/ai/detect");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<AiProviderDetection[]>;
}

export async function summarizeRunOutput(request: AiRunSummaryRequest): Promise<AiCompletion> {
  const response = await fetch("/api/ai/summarize-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<AiCompletion>;
}

export async function suggestSchemaPatch(settings: AiSettings, manifest: ToolManifest): Promise<AiSchemaPatchResponse> {
  const response = await fetch("/api/ai/suggest-schema", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings, manifest })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<AiSchemaPatchResponse>;
}
