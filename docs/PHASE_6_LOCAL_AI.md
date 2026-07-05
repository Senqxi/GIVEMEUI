# Phase 6 Local AI Enhancement Layer

Phase 6 adds optional AI without making AI required for GIVEMEUI.

The default mode remains deterministic-only. Users can enable a local provider when they want help improving schemas or explaining captured command output.

## Scope

- Provider-neutral AI settings.
- Local provider detection.
- Ollama support.
- LM Studio support through its OpenAI-compatible local API.
- Generic local OpenAI-compatible endpoint support.
- Output explanation from captured stdout/stderr and deterministic analysis.
- Reviewable schema metadata suggestions.
- Tests for AI defaults, prompts, and schema suggestion parsing.

## Provider Modes

- `none`: default deterministic mode.
- `ollama`: local Ollama server at `http://127.0.0.1:11434`.
- `lm-studio`: local LM Studio/OpenAI-compatible server at `http://127.0.0.1:1234/v1`.
- `local-openai-compatible`: user-provided local OpenAI-compatible endpoint.
- `openai`: reserved for a later opt-in cloud setup flow.

Cloud OpenAI mode is intentionally not configured in this alpha.

## Safety Boundaries

- AI never executes commands.
- AI never changes executable, arguments, defaults, or safety metadata.
- Schema suggestions are parsed as JSON and filtered to existing fields.
- Users must apply or dismiss each schema suggestion manually.
- Output explanations are based only on captured stdout, stderr, and deterministic analysis.
- The app continues working with AI disabled.

## Local API Endpoints

- `GET /api/ai/detect`
- `POST /api/ai/summarize-run`
- `POST /api/ai/suggest-schema`

Provider calls are made by the local GIVEMEUI API process, not directly by the browser UI.

## Exit Criteria Status

- App works with AI disabled: complete.
- Local AI can improve a schema without direct command execution: complete.
- User can review and accept/reject AI changes: complete.

## Next Hardening Steps

- Add a secure opt-in cloud provider setup flow.
- Add streaming completion support for long explanations.
- Add schema-diff grouping for larger suggestion batches.
- Add provider health caching.
- Add adapter-specific AI prompts after Phase 7 adapters exist.
