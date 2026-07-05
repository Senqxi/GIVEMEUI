export type OutputFormat = "json" | "ndjson" | "csv" | "tsv" | "text";
export type OutputStreamName = "stdout" | "stderr";

export type OutputJsonView = {
  source: OutputStreamName;
  value: unknown;
  pretty: string;
  ndjson: boolean;
};

export type OutputTableView = {
  source: OutputStreamName;
  delimiter: "," | "\t";
  headers: string[];
  rows: string[][];
  truncated: boolean;
};

export type OutputDiagnostic = {
  severity: "error" | "warning";
  stream: OutputStreamName;
  line: number;
  text: string;
};

export type OutputArtifact = {
  path: string;
  kind: "image" | "video" | "audio" | "file";
  stream: OutputStreamName;
  line: number;
  isAbsolute: boolean;
};

export type OutputProgress = {
  stream: OutputStreamName;
  line: number;
  percent?: number;
  text: string;
};

export type OutputAnalysis = {
  format: OutputFormat;
  json?: OutputJsonView;
  table?: OutputTableView;
  diagnostics: OutputDiagnostic[];
  artifacts: OutputArtifact[];
  progress: OutputProgress[];
  summary: {
    stdoutLines: number;
    stderrLines: number;
    errorCount: number;
    warningCount: number;
    artifactCount: number;
    progressCount: number;
  };
};

const MAX_TABLE_ROWS = 100;
const MAX_PROGRESS_ITEMS = 20;
const PATH_PATTERN = /(?:^|[\s"'(])((?:\/[^\s"'<>|]+|\.{1,2}\/[^\s"'<>|]+|(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+)\.(?:png|jpe?g|gif|webp|svg|mp4|mov|mkv|webm|mp3|wav|flac|aac|csv|tsv|json|txt|log|pdf))(?:$|[\s"',).])/gi;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".flac", ".aac"]);

export function analyzeRunOutput(stdout: string, stderr: string): OutputAnalysis {
  const stdoutLines = splitLines(stdout);
  const stderrLines = splitLines(stderr);
  const json = detectJson(stdout, "stdout") ?? detectJson(stderr, "stderr");
  const table = json ? undefined : detectTable(stdout, "stdout") ?? detectTable(stderr, "stderr");
  const diagnostics = [...detectDiagnostics(stdoutLines, "stdout"), ...detectDiagnostics(stderrLines, "stderr")];
  const artifacts = dedupeArtifacts([...detectArtifacts(stdoutLines, "stdout"), ...detectArtifacts(stderrLines, "stderr")]);
  const progress = [...detectProgress(stdoutLines, "stdout"), ...detectProgress(stderrLines, "stderr")].slice(-MAX_PROGRESS_ITEMS);

  return {
    format: json ? (json.ndjson ? "ndjson" : "json") : table ? (table.delimiter === "\t" ? "tsv" : "csv") : "text",
    json,
    table,
    diagnostics,
    artifacts,
    progress,
    summary: {
      stdoutLines: stdoutLines.length,
      stderrLines: stderrLines.length,
      errorCount: diagnostics.filter((item) => item.severity === "error").length,
      warningCount: diagnostics.filter((item) => item.severity === "warning").length,
      artifactCount: artifacts.length,
      progressCount: progress.length
    }
  };
}

function detectJson(text: string, source: OutputStreamName): OutputJsonView | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    const value = JSON.parse(trimmed) as unknown;
    return { source, value, pretty: JSON.stringify(value, null, 2), ndjson: false };
  } catch {
    const lines = splitLines(text).filter((line) => line.trim());
    if (lines.length < 2) return undefined;

    try {
      const values = lines.map((line) => JSON.parse(line) as unknown);
      return { source, value: values, pretty: JSON.stringify(values, null, 2), ndjson: true };
    } catch {
      return undefined;
    }
  }
}

function detectTable(text: string, source: OutputStreamName): OutputTableView | undefined {
  const lines = splitLines(text).filter((line) => line.trim());
  if (lines.length < 2) return undefined;

  const delimiter = scoreDelimiter(lines, "\t") >= scoreDelimiter(lines, ",") ? "\t" : ",";
  const rows = lines.map((line) => parseDelimitedLine(line, delimiter));
  const columnCount = rows[0]?.length ?? 0;
  if (columnCount < 2) return undefined;
  if (rows.filter((row) => row.length === columnCount).length < 2) return undefined;

  const normalizedRows = rows.filter((row) => row.length === columnCount);
  const headers = looksLikeHeader(normalizedRows[0]) ? normalizedRows[0] : normalizedRows[0].map((_, index) => `Column ${index + 1}`);
  const dataRows = looksLikeHeader(normalizedRows[0]) ? normalizedRows.slice(1) : normalizedRows;

  return {
    source,
    delimiter,
    headers,
    rows: dataRows.slice(0, MAX_TABLE_ROWS),
    truncated: dataRows.length > MAX_TABLE_ROWS
  };
}

function detectDiagnostics(lines: string[], stream: OutputStreamName): OutputDiagnostic[] {
  return lines.flatMap<OutputDiagnostic>((text, index) => {
    if (/\b(error|fatal|exception|traceback|failed|failure|denied)\b/i.test(text)) {
      return [{ severity: "error", stream, line: index + 1, text }];
    }
    if (/\b(warn|warning|deprecated|caution)\b/i.test(text)) {
      return [{ severity: "warning", stream, line: index + 1, text }];
    }
    return [];
  });
}

function detectProgress(lines: string[], stream: OutputStreamName): OutputProgress[] {
  return lines.flatMap((text, index) => {
    const percentMatch = text.match(/\b(100|[1-9]?\d)(?:\.\d+)?%/);
    const hasProgressSignal = percentMatch || /\b(progress|eta|frame=|time=|speed=|download|processed)\b/i.test(text);
    if (!hasProgressSignal) return [];

    const percent = percentMatch ? Number(percentMatch[1]) : undefined;
    return [{ stream, line: index + 1, percent, text }];
  });
}

function detectArtifacts(lines: string[], stream: OutputStreamName): OutputArtifact[] {
  const seen = new Set<string>();
  const artifacts: OutputArtifact[] = [];

  lines.forEach((line, index) => {
    for (const match of line.matchAll(PATH_PATTERN)) {
      const path = match[1]?.replace(/[),.;:]+$/, "");
      if (!path || seen.has(path)) continue;
      seen.add(path);
      artifacts.push({
        path,
        kind: artifactKind(path),
        stream,
        line: index + 1,
        isAbsolute: path.startsWith("/")
      });
    }
  });

  return artifacts;
}

function scoreDelimiter(lines: string[], delimiter: "," | "\t"): number {
  return lines.reduce((score, line) => score + Math.max(0, parseDelimitedLine(line, delimiter).length - 1), 0);
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function looksLikeHeader(row: string[]): boolean {
  return row.some((cell) => /[A-Za-z_ -]/.test(cell)) && row.every((cell) => cell.trim().length > 0);
}

function artifactKind(path: string): OutputArtifact["kind"] {
  const extension = path.match(/\.[A-Za-z0-9]+$/)?.[0].toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "file";
}

function dedupeArtifacts(artifacts: OutputArtifact[]): OutputArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.path)) return false;
    seen.add(artifact.path);
    return true;
  });
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}
