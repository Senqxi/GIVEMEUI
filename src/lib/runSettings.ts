const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TIMEOUT_SECONDS = 120;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 1800;

export function parseEnvText(input: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};

  input.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Environment line ${index + 1} must use KEY=value.`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Environment line ${index + 1} has an invalid key: ${key}.`);
    }

    env[key] = value;
  });

  return Object.keys(env).length > 0 ? env : undefined;
}

export function timeoutMsFromSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_TIMEOUT_SECONDS * 1000;
  return Math.round(clamp(seconds, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS) * 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
