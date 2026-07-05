export type ToolSource = "detected" | "imported" | "manual" | "ai-enhanced";

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "file"
  | "directory"
  | "multi-file"
  | "secret"
  | "array"
  | "raw";

export type ConfidenceLevel = "high" | "medium" | "low";

export type FieldValidation = {
  min?: number;
  max?: number;
  pattern?: string;
};

export type FieldUiHints = {
  group?: string;
  advanced?: boolean;
  control?: "text" | "textarea" | "select" | "switch" | "file" | "number";
};

export type FieldSpec = {
  id: string;
  label: string;
  description?: string;
  kind: FieldKind;
  required: boolean;
  position?: number;
  flag?: string;
  shortFlag?: string;
  defaultValue?: string | number | boolean | string[];
  choices?: string[];
  placeholder?: string;
  validation?: FieldValidation;
  ui?: FieldUiHints;
  confidence: number;
};

export type CommandExample = {
  label: string;
  args: string[];
};

export type OutputSpec = {
  expectedTypes: Array<"text" | "json" | "csv" | "file" | "image" | "video">;
};

export type SafetySpec = {
  destructive?: boolean;
  requiresShell?: boolean;
  notes?: string[];
};

export type ExecutableResolution = {
  input: string;
  executable: string;
  resolvedPath?: string;
  type: "absolute" | "relative" | "path" | "unresolved";
  cwd?: string;
};

export type DiscoveryAttempt = {
  command: string[];
  stdoutBytes: number;
  stderrBytes: number;
  exitCode: number | null;
  timedOut: boolean;
};

export type DiscoveryMetadata = {
  input: string;
  resolvedExecutable: string;
  resolution: ExecutableResolution;
  helpCommand: string[];
  helpAttempts: DiscoveryAttempt[];
  version?: string;
  versionCommand?: string[];
  warnings: string[];
};

export type CommandSpec = {
  id: string;
  name: string;
  description?: string;
  subcommand?: string[];
  fields: FieldSpec[];
  examples?: CommandExample[];
  output?: OutputSpec;
  safety?: SafetySpec;
};

export type ToolManifest = {
  id: string;
  name: string;
  description?: string;
  executable: string;
  baseArgs: string[];
  version?: string;
  source: ToolSource;
  rawHelp?: string;
  discovery?: DiscoveryMetadata;
  commands: CommandSpec[];
  createdAt: string;
  updatedAt: string;
};

export type DiscoveryRequest = {
  commandLine: string;
  cwd?: string;
};

export type DiscoveryResponse = {
  manifest: ToolManifest;
  executed: string[];
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  resolution?: ExecutableResolution;
  helpAttempts?: DiscoveryAttempt[];
  version?: string;
};

export type RunRequest = {
  executable: string;
  baseArgs: string[];
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  redactedFieldIds?: string[];
};

export type RunEvent =
  | { type: "start"; command: string[]; at: string }
  | { type: "stdout"; chunk: string; at: string }
  | { type: "stderr"; chunk: string; at: string }
  | { type: "exit"; exitCode: number | null; signal: string | null; durationMs: number; at: string }
  | { type: "error"; message: string; at: string };

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.78) return "high";
  if (confidence >= 0.52) return "medium";
  return "low";
}
