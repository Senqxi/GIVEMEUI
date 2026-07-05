import {
  buildRunOutputPrompt,
  buildSchemaSuggestionPrompt,
  DEFAULT_LOCAL_ENDPOINTS,
  normalizeAiSettings,
  parseSchemaSuggestions,
  type AiCompletion,
  type AiProviderDetection,
  type AiProviderMode,
  type AiRunSummaryRequest,
  type AiSchemaPatchResponse,
  type AiSettings
} from "../src/lib/ai";
import type { ToolManifest } from "../src/lib/schema";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type AiProvider = {
  mode: AiProviderMode;
  isAvailable(): Promise<AiProviderDetection>;
  complete(messages: ChatMessage[]): Promise<AiCompletion>;
  stream?(messages: ChatMessage[]): AsyncIterable<AiCompletion>;
  summarizeHelp(manifest: ToolManifest): Promise<AiCompletion>;
  summarizeRunOutput(request: AiRunSummaryRequest): Promise<AiCompletion>;
  suggestSchemaPatch(manifest: ToolManifest): Promise<AiSchemaPatchResponse>;
};

export async function detectLocalAiProviders(): Promise<AiProviderDetection[]> {
  const providers = [
    createProvider(normalizeAiSettings({ mode: "ollama" })),
    createProvider(normalizeAiSettings({ mode: "lm-studio" })),
    createProvider(normalizeAiSettings({ mode: "local-openai-compatible" }))
  ];

  return Promise.all(providers.map((provider) => provider.isAvailable()));
}

export async function summarizeRunOutput(request: AiRunSummaryRequest): Promise<AiCompletion> {
  const settings = normalizeAiSettings(request.settings);
  const provider = createProvider(settings);
  return provider.summarizeRunOutput({ ...request, settings });
}

export async function suggestSchemaPatch(settings: AiSettings, manifest: ToolManifest): Promise<AiSchemaPatchResponse> {
  const normalized = normalizeAiSettings(settings);
  const provider = createProvider(normalized);
  return provider.suggestSchemaPatch(manifest);
}

function createProvider(settings: AiSettings): AiProvider {
  if (settings.mode === "ollama") return createOllamaProvider(settings);
  if (settings.mode === "lm-studio" || settings.mode === "local-openai-compatible") return createOpenAiCompatibleProvider(settings);
  return createUnavailableProvider(settings);
}

function createOllamaProvider(settings: AiSettings): AiProvider {
  return {
    mode: "ollama",
    async isAvailable() {
      try {
        const response = await fetch(`${settings.endpoint}/api/tags`, { signal: AbortSignal.timeout(1200) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { models?: Array<{ name?: string }> };
        return {
          mode: "ollama",
          label: "Ollama",
          endpoint: settings.endpoint,
          available: true,
          models: body.models?.map((model) => model.name).filter(isString) ?? []
        };
      } catch (error) {
        return detectionError("ollama", "Ollama", settings.endpoint, error);
      }
    },
    async complete(messages) {
      const response = await fetch(`${settings.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          stream: false,
          messages
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { message?: { content?: string } };
      return completion(settings, body.message?.content ?? "");
    },
    async summarizeRunOutput(request) {
      return this.complete(promptMessages(buildRunOutputPrompt(request)));
    },
    async summarizeHelp(manifest) {
      return this.complete(promptMessages(`Summarize this local CLI help for schema review. Do not suggest command execution.\n\n${manifest.rawHelp ?? ""}`));
    },
    async suggestSchemaPatch(manifest) {
      const result = await this.complete(promptMessages(buildSchemaSuggestionPrompt(manifest)));
      return {
        suggestions: parseSchemaSuggestions(result.text, manifest),
        rawText: result.text,
        provider: result.provider,
        model: result.model,
        createdAt: result.createdAt
      };
    }
  };
}

function createOpenAiCompatibleProvider(settings: AiSettings): AiProvider {
  const label = settings.mode === "lm-studio" ? "LM Studio" : "OpenAI-compatible";
  return {
    mode: settings.mode,
    async isAvailable() {
      try {
        const response = await fetch(`${settings.endpoint}/models`, { signal: AbortSignal.timeout(1200) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { data?: Array<{ id?: string }> };
        return {
          mode: settings.mode as Exclude<AiProviderMode, "none" | "openai">,
          label,
          endpoint: settings.endpoint,
          available: true,
          models: body.data?.map((model) => model.id).filter(isString) ?? []
        };
      } catch (error) {
        return detectionError(settings.mode as Exclude<AiProviderMode, "none" | "openai">, label, settings.endpoint, error);
      }
    },
    async complete(messages) {
      const response = await fetch(`${settings.endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.2,
          messages
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return completion(settings, body.choices?.[0]?.message?.content ?? "");
    },
    async summarizeRunOutput(request) {
      return this.complete(promptMessages(buildRunOutputPrompt(request)));
    },
    async summarizeHelp(manifest) {
      return this.complete(promptMessages(`Summarize this local CLI help for schema review. Do not suggest command execution.\n\n${manifest.rawHelp ?? ""}`));
    },
    async suggestSchemaPatch(manifest) {
      const result = await this.complete(promptMessages(buildSchemaSuggestionPrompt(manifest)));
      return {
        suggestions: parseSchemaSuggestions(result.text, manifest),
        rawText: result.text,
        provider: result.provider,
        model: result.model,
        createdAt: result.createdAt
      };
    }
  };
}

function createUnavailableProvider(settings: AiSettings): AiProvider {
  return {
    mode: settings.mode,
    async isAvailable() {
      return {
        mode: "local-openai-compatible",
        label: settings.mode === "openai" ? "OpenAI cloud" : "AI disabled",
        endpoint: settings.endpoint,
        available: false,
        models: [],
        error: settings.mode === "none" ? "AI is disabled." : "Cloud OpenAI mode is not configured in this local alpha."
      };
    },
    async complete() {
      throw new Error(settings.mode === "none" ? "AI is disabled." : "Cloud OpenAI mode is not configured in this local alpha.");
    },
    async summarizeRunOutput() {
      return this.complete([]);
    },
    async summarizeHelp() {
      return this.complete([]);
    },
    async suggestSchemaPatch() {
      throw new Error(settings.mode === "none" ? "AI is disabled." : "Cloud OpenAI mode is not configured in this local alpha.");
    }
  };
}

function promptMessages(prompt: string): ChatMessage[] {
  return [
    { role: "system", content: "You are an optional local AI assistant inside GIVEMEUI. You never execute commands." },
    { role: "user", content: prompt }
  ];
}

function completion(settings: AiSettings, text: string): AiCompletion {
  return {
    provider: settings.mode,
    model: settings.model,
    text: text.trim(),
    createdAt: new Date().toISOString()
  };
}

function detectionError(
  mode: Exclude<AiProviderMode, "none" | "openai">,
  label: string,
  endpoint: string,
  error: unknown
): AiProviderDetection {
  return {
    mode,
    label,
    endpoint,
    available: false,
    models: [],
    error: error instanceof Error ? error.message : "Provider unavailable."
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
