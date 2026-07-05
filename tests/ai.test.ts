import { describe, expect, it } from "vitest";
import { analyzeRunOutput } from "../src/lib/outputAnalysis";
import {
  buildRunOutputPrompt,
  buildSchemaSuggestionPrompt,
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  parseSchemaSuggestions
} from "../src/lib/ai";
import { sampleManifest } from "../src/lib/sampleData";

describe("AI enhancement helpers", () => {
  it("keeps AI disabled by default", () => {
    expect(DEFAULT_AI_SETTINGS).toEqual({ mode: "none", endpoint: "", model: "" });
    expect(normalizeAiSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("normalizes local provider defaults", () => {
    expect(normalizeAiSettings({ mode: "ollama" })).toEqual({
      mode: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "llama3.1"
    });
  });

  it("builds output prompts that forbid command execution", () => {
    const prompt = buildRunOutputPrompt({
      settings: normalizeAiSettings({ mode: "ollama" }),
      command: "demo --json",
      stdout: '{"ok":true}',
      stderr: "WARNING: review output",
      analysis: analyzeRunOutput('{"ok":true}', "WARNING: review output")
    });

    expect(prompt).toContain("Do not suggest running new commands");
    expect(prompt).toContain("Detected format: json");
    expect(prompt).toContain("Warnings: 1");
  });

  it("builds schema prompts that require JSON-only reviewable patches", () => {
    const prompt = buildSchemaSuggestionPrompt(sampleManifest);

    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain("Do not add new commands");
    expect(prompt).toContain(sampleManifest.executable);
  });

  it("parses schema suggestions only for existing fields", () => {
    const commandId = sampleManifest.commands[0].id;
    const fieldId = sampleManifest.commands[0].fields[0].id;
    const suggestions = parseSchemaSuggestions(
      JSON.stringify({
        suggestions: [
          { commandId, fieldId, label: "Better Label", group: "Core", reason: "Clearer" },
          { commandId, fieldId: "missing-field", label: "Invalid" }
        ]
      }),
      sampleManifest
    );

    expect(suggestions).toEqual([
      {
        commandId,
        fieldId,
        label: "Better Label",
        group: "Core",
        reason: "Clearer"
      }
    ]);
  });
});
