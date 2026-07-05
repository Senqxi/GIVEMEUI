import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BotOff,
  CheckCircle2,
  CircleStop,
  Clock3,
  FileJson2,
  History,
  Library,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  Wrench
} from "./components/icons";
import { discoverTool, runCommandStream } from "./lib/api";
import { buildCommandPreview, buildRunRequest, initialValuesFor, type FieldValues } from "./lib/commandBuilder";
import { formatCommand } from "./lib/commandLine";
import { sampleManifest } from "./lib/sampleData";
import {
  appendPreset,
  appendRun,
  createStorageId,
  loadWorkspace,
  persistWorkspace,
  redactSecretValues,
  upsertManifest,
  type SavedPreset,
  type StoredRun,
  type WorkspaceState
} from "./lib/storage";
import { confidenceLevel, type CommandSpec, type FieldKind, type FieldSpec, type FieldUiHints, type RunEvent, type ToolManifest } from "./lib/schema";
import { isReviewField, normalizeToolManifest, validateToolManifest, type SchemaValidationResult } from "./lib/schemaValidation";

type ConsoleLine = {
  id: string;
  stream: "system" | "stdout" | "stderr";
  text: string;
  at: string;
};

type RunState = {
  running: boolean;
  exitCode: number | null;
  durationMs: number | null;
  command: string[];
};

type RunCapture = {
  toolId: string;
  commandId: string;
  toolName: string;
  commandName: string;
  command: string[];
  preview: string;
  stdout: string;
  stderr: string;
  startedAt: string;
};

type FieldDraft = {
  label: string;
  description: string;
  kind: FieldKind;
  group: string;
  defaultValue: string;
  placeholder: string;
  choices: string;
  validationMin: string;
  validationMax: string;
  validationPattern: string;
  required: boolean;
  advanced: boolean;
};

const FIELD_KINDS: FieldKind[] = ["string", "number", "boolean", "enum", "file", "directory", "multi-file", "secret", "array", "raw"];
const MAX_VISIBLE_FIELDS = 18;

export function App() {
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() => loadWorkspace(sampleManifest));
  const [commandInput, setCommandInput] = useState("python3 --help");
  const [selectedCommandId, setSelectedCommandId] = useState(sampleManifest.commands[0].id);
  const [values, setValues] = useState<FieldValues>(() => initialValuesFor(sampleManifest.commands[0]));
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(sampleManifest.commands[0].fields[0]?.id ?? null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([
    {
      id: "seed",
      stream: "system",
      text: "Local API ready. Discover a command, review the schema, then run it.",
      at: new Date().toISOString()
    }
  ]);
  const [runState, setRunState] = useState<RunState>({
    running: false,
    exitCode: null,
    durationMs: null,
    command: []
  });
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [activeConsoleTab, setActiveConsoleTab] = useState<"all" | "stdout" | "stderr">("all");
  const abortRef = useRef<AbortController | null>(null);
  const runCaptureRef = useRef<RunCapture | null>(null);

  const manifest = useMemo(() => {
    return workspaceState.manifests.find((tool) => tool.id === workspaceState.activeToolId) ?? workspaceState.manifests[0] ?? sampleManifest;
  }, [workspaceState]);

  const selectedCommand = manifest.commands.find((command) => command.id === selectedCommandId) ?? manifest.commands[0] ?? sampleManifest.commands[0];
  const renderableFields = useMemo(() => {
    return selectedCommand.fields.filter((field) => showAdvanced || !field.ui?.advanced);
  }, [selectedCommand.fields, showAdvanced]);
  const visibleFields = useMemo(() => renderableFields.slice(0, MAX_VISIBLE_FIELDS), [renderableFields]);
  const hiddenFieldCount = Math.max(0, selectedCommand.fields.length - visibleFields.length);
  const selectedField = selectedCommand.fields.find((field) => field.id === selectedFieldId) ?? selectedCommand.fields[0] ?? null;
  const commandPreview = useMemo(() => {
    return buildCommandPreview(manifest, selectedCommand, values);
  }, [manifest, selectedCommand, values]);
  const commandPresets = useMemo(() => {
    return workspaceState.presets.filter((preset) => preset.toolId === manifest.id && preset.commandId === selectedCommand.id);
  }, [manifest.id, selectedCommand.id, workspaceState.presets]);
  const schemaValidation = useMemo(() => validateToolManifest(manifest), [manifest]);

  const fieldStats = useMemo(() => {
    const total = selectedCommand.fields.length || 1;
    const high = selectedCommand.fields.filter((field) => confidenceLevel(field.confidence) === "high").length;
    const medium = selectedCommand.fields.filter((field) => confidenceLevel(field.confidence) === "medium").length;
    const low = selectedCommand.fields.filter((field) => confidenceLevel(field.confidence) === "low").length;
    return { high, medium, low, total };
  }, [selectedCommand.fields]);

  useEffect(() => {
    const nextCommand = manifest.commands.find((command) => command.id === selectedCommandId) ?? manifest.commands[0];
    if (!nextCommand) return;

    if (selectedCommandId !== nextCommand.id) {
      setSelectedCommandId(nextCommand.id);
    }

    setValues((current) => reconcileValues(nextCommand, current));
    setSelectedFieldId((current) => {
      if (current && nextCommand.fields.some((field) => field.id === current)) return current;
      return nextCommand.fields[0]?.id ?? null;
    });
  }, [manifest, selectedCommandId]);

  function commitWorkspace(updater: (current: WorkspaceState) => WorkspaceState) {
    setWorkspaceState((current) => {
      const next = updater(current);
      persistWorkspace(next);
      return next;
    });
  }

  async function handleDiscover() {
    setIsDiscovering(true);
    appendConsole("system", `Discovering ${commandInput}`);

    try {
      const result = await discoverTool({ commandLine: commandInput });
      commitWorkspace((current) => upsertManifest(current, result.manifest));
      setSelectedCommandId(result.manifest.commands[0].id);
      setSelectedFieldId(result.manifest.commands[0].fields[0]?.id ?? null);
      setValues(initialValuesFor(result.manifest.commands[0]));
      appendConsole("system", `Captured help via ${formatCommand(result.executed)} (${result.manifest.commands[0].fields.length} fields).`);
      if (result.resolution?.resolvedPath) {
        appendConsole("system", `Resolved executable: ${result.resolution.resolvedPath}`);
      }
      if (result.version) {
        appendConsole("system", `Captured version: ${result.version}`);
      }
      for (const warning of result.manifest.discovery?.warnings ?? []) {
        appendConsole("stderr", warning);
      }

      if (result.stderr.trim()) {
        appendConsole("stderr", result.stderr.trim());
      }
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Discovery failed.");
    } finally {
      setIsDiscovering(false);
    }
  }

  async function handleRun() {
    if (runState.running) return;

    const request = buildRunRequest(manifest, selectedCommand, values);
    const redactedValues = redactSecretValues(selectedCommand.fields, values, "[redacted]");
    const redactedRequest = buildRunRequest(manifest, selectedCommand, redactedValues);
    const actualCommand = [request.executable, ...request.baseArgs, ...request.args];
    const redactedCommand = [redactedRequest.executable, ...redactedRequest.baseArgs, ...redactedRequest.args];
    const controller = new AbortController();
    abortRef.current = controller;
    runCaptureRef.current = {
      toolId: manifest.id,
      commandId: selectedCommand.id,
      toolName: manifest.name,
      commandName: selectedCommand.name,
      command: redactedCommand,
      preview: formatCommand(redactedCommand),
      stdout: "",
      stderr: "",
      startedAt: new Date().toISOString()
    };
    setRunState({ running: true, exitCode: null, durationMs: null, command: actualCommand });
    appendConsole("system", `Running ${formatCommand(redactedCommand)}`);

    try {
      await runCommandStream(
        request,
        (event) => {
          handleRunEvent(event);
        },
        controller.signal
      );
    } catch (error) {
      if (controller.signal.aborted) {
        appendConsole("system", "Run canceled by user.");
      } else {
        appendConsole("stderr", error instanceof Error ? error.message : "Run failed.");
      }
      setRunState((state) => ({ ...state, running: false }));
      runCaptureRef.current = null;
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setRunState((state) => ({ ...state, running: false }));
  }

  function handleRunEvent(event: RunEvent) {
    if (event.type === "start") {
      setRunState((state) => ({ ...state, command: event.command }));
      return;
    }

    if (event.type === "stdout" || event.type === "stderr") {
      if (runCaptureRef.current) {
        runCaptureRef.current[event.type] += event.chunk;
      }
      appendConsole(event.type, event.chunk);
      return;
    }

    if (event.type === "error") {
      if (runCaptureRef.current) {
        runCaptureRef.current.stderr += event.message;
      }
      appendConsole("stderr", event.message);
      return;
    }

    setRunState((state) => ({
      ...state,
      running: false,
      exitCode: event.exitCode,
      durationMs: event.durationMs
    }));
    appendConsole("system", `Exited with code ${event.exitCode ?? "signal"} in ${event.durationMs}ms.`);

    if (runCaptureRef.current) {
      const capture = runCaptureRef.current;
      const storedRun: StoredRun = {
        id: createStorageId("run"),
        toolId: capture.toolId,
        commandId: capture.commandId,
        toolName: capture.toolName,
        commandName: capture.commandName,
        command: capture.command,
        preview: capture.preview,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        stdout: capture.stdout,
        stderr: capture.stderr,
        startedAt: capture.startedAt,
        completedAt: event.at
      };
      commitWorkspace((current) => appendRun(current, storedRun));
      runCaptureRef.current = null;
    }
  }

  function handleSelectManifest(toolId: string) {
    const nextManifest = workspaceState.manifests.find((tool) => tool.id === toolId);
    if (!nextManifest) return;

    commitWorkspace((current) => ({ ...current, activeToolId: toolId }));
    setSelectedCommandId(nextManifest.commands[0].id);
    setSelectedFieldId(nextManifest.commands[0].fields[0]?.id ?? null);
    setValues(initialValuesFor(nextManifest.commands[0]));
  }

  function handleSelectCommand(commandId: string) {
    const nextCommand = manifest.commands.find((command) => command.id === commandId);
    if (!nextCommand) return;

    setSelectedCommandId(nextCommand.id);
    setSelectedFieldId(nextCommand.fields[0]?.id ?? null);
    setValues(initialValuesFor(nextCommand));
  }

  function handleNewTool() {
    setCommandInput("");
    appendConsole("system", "Enter a command in the discovery bar to create a new local tool schema.");
  }

  function handleUpdateField(fieldId: string, patch: Partial<FieldSpec>) {
    if (patch.kind) {
      setValues((current) => ({
        ...current,
        [fieldId]: patch.kind === "boolean" ? false : ""
      }));
    }

    commitWorkspace((current) => {
      const now = new Date().toISOString();
      return {
        ...current,
        manifests: current.manifests.map((tool) => {
          if (tool.id !== manifest.id) return tool;

          return {
            ...tool,
            updatedAt: now,
            commands: tool.commands.map((command) => {
              if (command.id !== selectedCommand.id) return command;

              return {
                ...command,
                fields: command.fields.map((field) => {
                  if (field.id !== fieldId) return field;
                  return {
                    ...field,
                    ...patch,
                    ui: patch.ui ? { ...field.ui, ...patch.ui } : field.ui
                  };
                })
              };
            })
          };
        })
      };
    });
  }

  function handleSavePreset() {
    const suggestedName = `${selectedCommand.name} preset ${commandPresets.length + 1}`;
    const name = window.prompt("Preset name", suggestedName)?.trim();
    if (!name) return;

    const now = new Date().toISOString();
    const preset: SavedPreset = {
      id: createStorageId("preset"),
      toolId: manifest.id,
      commandId: selectedCommand.id,
      name,
      values: redactSecretValues(selectedCommand.fields, values),
      createdAt: now,
      updatedAt: now
    };
    commitWorkspace((current) => appendPreset(current, preset));
    appendConsole("system", `Saved preset "${name}".`);
  }

  function handleLoadPreset(presetId: string) {
    const preset = workspaceState.presets.find((item) => item.id === presetId);
    if (!preset) return;

    setValues(reconcileValues(selectedCommand, preset.values));
    appendConsole("system", `Loaded preset "${preset.name}".`);
  }

  async function handleExportSchema() {
    const json = JSON.stringify(manifest, null, 2);

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(json);
      appendConsole("system", `Copied ${manifest.name} schema JSON to clipboard.`);
    } catch {
      window.prompt("Copy schema JSON", json);
      appendConsole("system", `Opened ${manifest.name} schema JSON for copying.`);
    }
  }

  function handleImportSchema() {
    const pasted = window.prompt("Paste a ToolManifest JSON object");
    if (!pasted) return;

    try {
      const parsed: unknown = JSON.parse(pasted);
      const validation = validateToolManifest(parsed);
      if (!validation.valid) {
        throw new Error(`Schema import failed: ${validation.errors.slice(0, 3).join(" ")}`);
      }

      const imported: ToolManifest = {
        ...normalizeToolManifest(parsed as ToolManifest),
        source: "imported",
        updatedAt: new Date().toISOString()
      };
      commitWorkspace((current) => upsertManifest(current, imported));
      setSelectedCommandId(imported.commands[0].id);
      setSelectedFieldId(imported.commands[0].fields.find(isReviewField)?.id ?? imported.commands[0].fields[0]?.id ?? null);
      setValues(initialValuesFor(imported.commands[0]));
      appendConsole(
        "system",
        `Imported schema for ${imported.name}. ${validation.warnings.length ? `${validation.warnings.length} review warnings.` : "Opened in review mode."}`
      );
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Schema import failed.");
    }
  }

  function handleSelectRun(run: StoredRun) {
    setConsoleLines(consoleLinesForRun(run));
    setRunState({
      running: false,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      command: run.command
    });
    setActiveConsoleTab("all");
  }

  function appendConsole(stream: ConsoleLine["stream"], text: string) {
    setConsoleLines((current) => [...current, ...createConsoleLines(stream, text)]);
  }

  return (
    <main className="app-shell">
      <Sidebar
        activeToolId={manifest.id}
        manifests={workspaceState.manifests}
        runCount={workspaceState.runs.length}
        onNewTool={handleNewTool}
        onSelectManifest={handleSelectManifest}
        onShowRuns={() => setActiveConsoleTab("all")}
      />
      <section className="workspace">
        <DiscoveryBar
          commandInput={commandInput}
          isDiscovering={isDiscovering}
          onCommandInputChange={setCommandInput}
          onDiscover={handleDiscover}
        />
        <div className="work-grid">
          <section className="primary-panel">
            <PanelHeader
              icon={<Wrench size={17} />}
              title="Generated UI"
              subtitle={`${manifest.name}${manifest.version ? ` · ${manifest.version}` : ""} · ${selectedCommand.fields.length} detected fields`}
              action={
                <div className="panel-actions">
                  <select
                    className="command-select"
                    value={selectedCommand.id}
                    onChange={(event) => handleSelectCommand(event.target.value)}
                    aria-label="Command"
                  >
                    {manifest.commands.map((command) => (
                      <option value={command.id} key={command.id}>
                        {command.name}
                      </option>
                    ))}
                  </select>
                  <label className="inline-check">
                    <input type="checkbox" checked={showAdvanced} onChange={(event) => setShowAdvanced(event.target.checked)} />
                    Advanced
                  </label>
                  <StatusPill label="Local Only" tone="success" />
                </div>
              }
            />
            <GeneratedForm
              command={selectedCommand}
              fields={visibleFields}
              hiddenFieldCount={hiddenFieldCount}
              values={values}
              onValueChange={(fieldId, value) => setValues((current) => ({ ...current, [fieldId]: value }))}
            />
            <CommandPreview
              presets={commandPresets}
              preview={commandPreview}
              runState={runState}
              onCancel={handleCancel}
              onLoadPreset={handleLoadPreset}
              onRun={handleRun}
              onSavePreset={handleSavePreset}
            />
          </section>
          <aside className="inspector-panel">
            <PanelHeader
              icon={<FileJson2 size={17} />}
              title="Schema Review"
              subtitle="Editable schema draft"
              action={
                <div className="schema-actions">
                  <button className="mini-button" onClick={handleImportSchema}>
                    Import
                  </button>
                  <button className="mini-button" onClick={() => void handleExportSchema()}>
                    Export
                  </button>
                </div>
              }
            />
            <ToolDiscoveryPanel manifest={manifest} />
            <SchemaSummary fields={selectedCommand.fields} stats={fieldStats} />
            <FieldInspector
              fields={selectedCommand.fields}
              manifest={manifest}
              validation={schemaValidation}
              selectedField={selectedField}
              selectedFieldId={selectedField?.id ?? null}
              onFieldSelect={setSelectedFieldId}
              onFieldUpdate={handleUpdateField}
            />
          </aside>
        </div>
        <OutputConsole
          activeTab={activeConsoleTab}
          lines={consoleLines}
          runs={workspaceState.runs}
          runState={runState}
          onRerun={handleRun}
          onRunSelect={handleSelectRun}
          onTabChange={setActiveConsoleTab}
        />
      </section>
    </main>
  );
}

function Sidebar({
  activeToolId,
  manifests,
  runCount,
  onNewTool,
  onSelectManifest,
  onShowRuns
}: {
  activeToolId: string;
  manifests: ToolManifest[];
  runCount: number;
  onNewTool: () => void;
  onSelectManifest: (toolId: string) => void;
  onShowRuns: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Terminal size={19} />
        </div>
        <div>
          <div className="brand-title">GIVEMEUI</div>
          <div className="brand-subtitle">CLI to UI</div>
        </div>
      </div>

      <button className="new-tool-button" onClick={onNewTool}>
        <Sparkles size={16} />
        New Tool
      </button>

      <nav className="sidebar-section">
        <div className="section-label">Tool Library</div>
        <div className="tool-list">
          {manifests.map((tool) => (
            <button className={`tool-row ${activeToolId === tool.id ? "selected" : ""}`} onClick={() => onSelectManifest(tool.id)} key={tool.id}>
              <Library size={16} />
              <span>
                <strong>{tool.name}</strong>
                <small>{tool.commands.length === 1 ? "1 command" : `${tool.commands.length} commands`}</small>
              </span>
            </button>
          ))}
        </div>
        <button className="tool-row" onClick={onShowRuns}>
          <History size={16} />
          <span>
            <strong>Run History</strong>
            <small>{runCount} local runs</small>
          </span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="local-state">
          <BotOff size={15} />
          <span>AI Optional</span>
        </div>
        <button className="icon-text-button">
          <Settings2 size={15} />
          Settings
        </button>
      </div>
    </aside>
  );
}

function DiscoveryBar({
  commandInput,
  isDiscovering,
  onCommandInputChange,
  onDiscover
}: {
  commandInput: string;
  isDiscovering: boolean;
  onCommandInputChange: (value: string) => void;
  onDiscover: () => void;
}) {
  return (
    <header className="discovery-bar">
      <div className="command-search">
        <Search size={17} />
        <input
          data-testid="command-discovery-input"
          value={commandInput}
          onChange={(event) => onCommandInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onDiscover();
          }}
          aria-label="Command to discover"
        />
      </div>
      <button className="secondary-button" data-testid="discover-command" onClick={onDiscover} disabled={isDiscovering}>
        {isDiscovering ? "Discovering" : "Discover"}
      </button>
    </header>
  );
}

function PanelHeader({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="panel-header">
      <div className="panel-title-group">
        <span className="panel-icon">{icon}</span>
        <span>
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      </div>
      {action}
    </div>
  );
}

function GeneratedForm({
  command,
  fields,
  hiddenFieldCount,
  values,
  onValueChange
}: {
  command: CommandSpec;
  fields: FieldSpec[];
  hiddenFieldCount: number;
  values: FieldValues;
  onValueChange: (fieldId: string, value: FieldValues[string]) => void;
}) {
  const grouped = groupFields(fields);

  return (
    <div className="generated-form">
      {Object.entries(grouped).map(([group, groupFields]) => (
        <section className="field-group" key={group}>
          <div className="field-group-title">{group}</div>
          <div className="field-grid">
            {groupFields.map((field) => (
              <GeneratedField key={field.id} field={field} value={values[field.id]} onValueChange={onValueChange} />
            ))}
          </div>
        </section>
      ))}
      {hiddenFieldCount > 0 ? (
        <div className="hidden-fields-note">
          <AlertTriangle size={15} />
          {hiddenFieldCount} fields hidden by the current view.
        </div>
      ) : null}
      {command.fields.length === 0 ? (
        <div className="empty-state">
          <Terminal size={24} />
          <strong>No fields detected</strong>
          <span>Run the command directly or adjust the schema after discovery.</span>
        </div>
      ) : null}
    </div>
  );
}

function GeneratedField({
  field,
  value,
  onValueChange
}: {
  field: FieldSpec;
  value: FieldValues[string];
  onValueChange: (fieldId: string, value: FieldValues[string]) => void;
}) {
  if (field.kind === "boolean") {
    return (
      <label className="field-row switch-row">
        <span>
          <strong>{field.label}</strong>
          <small>{field.description ?? field.flag ?? field.shortFlag}</small>
        </span>
        <input
          data-testid={`field-${field.id}`}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onValueChange(field.id, event.target.checked)}
        />
      </label>
    );
  }

  return (
    <label className="field-row">
      <span className="field-label-line">
        <strong>{field.label}</strong>
        <code>{field.flag ?? field.shortFlag}</code>
      </span>
      {field.kind === "enum" ? (
        <select
          data-testid={`field-${field.id}`}
          value={String(value ?? "")}
          onChange={(event) => onValueChange(field.id, event.target.value)}
        >
          <option value="">Unset</option>
          {field.choices?.map((choice) => (
            <option value={choice} key={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.kind === "number" ? "number" : field.kind === "secret" ? "password" : "text"}
          data-testid={`field-${field.id}`}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(event) =>
            onValueChange(field.id, field.kind === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)
          }
        />
      )}
      {field.description ? <small className="field-help">{field.description}</small> : null}
    </label>
  );
}

function CommandPreview({
  presets,
  preview,
  onRun,
  onCancel,
  onSavePreset,
  onLoadPreset,
  runState
}: {
  presets: SavedPreset[];
  preview: string;
  onRun: () => void;
  onCancel: () => void;
  onSavePreset: () => void;
  onLoadPreset: (presetId: string) => void;
  runState: RunState;
}) {
  return (
    <section className="command-preview">
      <div className="command-preview-header">
        <span>Command Preview</span>
        <div className="command-preview-controls">
          <div className="preset-controls">
            <select aria-label="Load preset" value="" onChange={(event) => event.target.value && onLoadPreset(event.target.value)}>
              <option value="">Presets</option>
              {presets.map((preset) => (
                <option value={preset.id} key={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button className="secondary-button compact-button" onClick={onSavePreset}>
              Save Preset
            </button>
          </div>
          <div className="run-actions">
            {runState.running ? (
              <button className="danger-button" data-testid="cancel-run" onClick={onCancel}>
                <CircleStop size={16} />
                Cancel
              </button>
            ) : null}
            <button className="primary-button" data-testid="run-command" onClick={onRun} disabled={runState.running}>
              <Play size={16} />
              Run
            </button>
          </div>
        </div>
      </div>
      <pre>{preview}</pre>
    </section>
  );
}

function SchemaSummary({
  fields,
  stats
}: {
  fields: FieldSpec[];
  stats: { high: number; medium: number; low: number; total: number };
}) {
  return (
    <section className="schema-summary">
      <div className="summary-stat">
        <strong>{fields.length}</strong>
        <span>fields</span>
      </div>
      <div className="confidence-bars">
        <ConfidenceBar label="High" value={stats.high} total={stats.total} />
        <ConfidenceBar label="Medium" value={stats.medium} total={stats.total} />
        <ConfidenceBar label="Low" value={stats.low} total={stats.total} />
      </div>
    </section>
  );
}

function ToolDiscoveryPanel({ manifest }: { manifest: ToolManifest }) {
  const discovery = manifest.discovery;

  if (!discovery) {
    return (
      <section className="discovery-metadata">
        <div className="metadata-row">
          <span>Executable</span>
          <code>{manifest.executable}</code>
        </div>
      </section>
    );
  }

  return (
    <section className="discovery-metadata">
      <div className="metadata-row">
        <span>Resolved</span>
        <code>{discovery.resolvedExecutable}</code>
      </div>
      <div className="metadata-row">
        <span>Source</span>
        <code>{discovery.resolution.type}</code>
      </div>
      {manifest.version ? (
        <div className="metadata-row">
          <span>Version</span>
          <code>{manifest.version}</code>
        </div>
      ) : null}
      <div className="metadata-row">
        <span>Help</span>
        <code>{formatCommand(discovery.helpCommand)}</code>
      </div>
      <div className="metadata-row">
        <span>Attempts</span>
        <code>{discovery.helpAttempts.length}</code>
      </div>
      {discovery.warnings.length > 0 ? (
        <div className="metadata-warning">
          <AlertTriangle size={14} />
          <span>{discovery.warnings[0]}</span>
        </div>
      ) : null}
    </section>
  );
}

function ConfidenceBar({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = Math.round((value / total) * 100);
  return (
    <div className="confidence-row">
      <span>{label}</span>
      <div className="confidence-track">
        <div style={{ width: `${percent}%` }} />
      </div>
      <code>{value}</code>
    </div>
  );
}

function FieldInspector({
  fields,
  manifest,
  validation,
  selectedField,
  selectedFieldId,
  onFieldSelect,
  onFieldUpdate
}: {
  fields: FieldSpec[];
  manifest: ToolManifest;
  validation: SchemaValidationResult;
  selectedField: FieldSpec | null;
  selectedFieldId: string | null;
  onFieldSelect: (fieldId: string) => void;
  onFieldUpdate: (fieldId: string, patch: Partial<FieldSpec>) => void;
}) {
  const [filter, setFilter] = useState<"all" | "review">("all");
  const reviewCount = fields.filter(isReviewField).length;
  const visibleFields = filter === "review" ? fields.filter(isReviewField) : fields;

  return (
    <div className="field-inspector">
      <SchemaValidationPanel validation={validation} />
      <div className="review-toolbar">
        <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")} data-testid="field-filter-all">
          All Fields
        </button>
        <button className={filter === "review" ? "selected" : ""} onClick={() => setFilter("review")} data-testid="field-filter-review">
          Needs Review <span>{reviewCount}</span>
        </button>
      </div>
      <div className="inspector-list">
        <div className="field-table-head">
          <span>Field</span>
          <span>Type</span>
          <span>Confidence</span>
        </div>
        {visibleFields.map((field) => {
          const level = confidenceLevel(field.confidence);
          return (
            <button
              className={`inspector-row ${selectedFieldId === field.id ? "selected" : ""}`}
              onClick={() => onFieldSelect(field.id)}
              key={field.id}
              data-testid={`schema-field-${field.id}`}
            >
              <div>
                <strong>{field.label}</strong>
                <small>{field.flag ?? field.shortFlag ?? field.kind}</small>
              </div>
              <code>{field.kind}</code>
              <span className={`confidence-pill ${level}`}>{level}</span>
            </button>
          );
        })}
        {visibleFields.length === 0 ? <div className="empty-review-list">No fields need review.</div> : null}
      </div>
      {selectedField ? <FieldDetailEditor field={selectedField} onUpdate={(patch) => onFieldUpdate(selectedField.id, patch)} /> : null}
      <SchemaSourceView manifest={manifest} />
    </div>
  );
}

function FieldDetailEditor({ field, onUpdate }: { field: FieldSpec; onUpdate: (patch: Partial<FieldSpec>) => void }) {
  const [draft, setDraft] = useState<FieldDraft>(() => createFieldDraft(field));

  useEffect(() => {
    setDraft(createFieldDraft(field));
  }, [field]);

  const cleanDraft = createFieldDraft(field);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(cleanDraft);
  const canSave = draft.label.trim().length > 0;

  return (
    <section className="field-detail-editor">
      <div className="editor-heading">
        <span>
          <strong>{field.label}</strong>
          <small>{confidenceLevel(field.confidence)} confidence</small>
        </span>
        <code>{field.flag ?? field.shortFlag ?? field.id}</code>
      </div>
      <label className="editor-field">
        <span>Label</span>
        <input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} data-testid="field-editor-label" />
      </label>
      <label className="editor-field">
        <span>Description</span>
        <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
      </label>
      <div className="editor-grid-two">
        <label className="editor-field">
          <span>Type</span>
          <select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as FieldKind }))}>
            {FIELD_KINDS.map((kind) => (
              <option value={kind} key={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="editor-field">
          <span>Group</span>
          <input
            value={draft.group}
            onChange={(event) => setDraft((current) => ({ ...current, group: event.target.value }))}
          />
        </label>
      </div>
      <div className="editor-grid-two">
        <label className="editor-field">
          <span>Default</span>
          <input value={draft.defaultValue} onChange={(event) => setDraft((current) => ({ ...current, defaultValue: event.target.value }))} />
        </label>
        <label className="editor-field">
          <span>Placeholder</span>
          <input value={draft.placeholder} onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))} />
        </label>
      </div>
      <label className="editor-field">
        <span>Choices</span>
        <input
          value={draft.choices}
          onChange={(event) => setDraft((current) => ({ ...current, choices: event.target.value }))}
        />
      </label>
      <div className="editor-grid-three">
        <label className="editor-field">
          <span>Min</span>
          <input value={draft.validationMin} onChange={(event) => setDraft((current) => ({ ...current, validationMin: event.target.value }))} />
        </label>
        <label className="editor-field">
          <span>Max</span>
          <input value={draft.validationMax} onChange={(event) => setDraft((current) => ({ ...current, validationMax: event.target.value }))} />
        </label>
        <label className="editor-field">
          <span>Pattern</span>
          <input value={draft.validationPattern} onChange={(event) => setDraft((current) => ({ ...current, validationPattern: event.target.value }))} />
        </label>
      </div>
      <div className="editor-checks">
        <label className="editor-check">
          <input type="checkbox" checked={draft.required} onChange={(event) => setDraft((current) => ({ ...current, required: event.target.checked }))} />
          Required
        </label>
        <label className="editor-check">
          <input
            type="checkbox"
            checked={draft.advanced}
            onChange={(event) => setDraft((current) => ({ ...current, advanced: event.target.checked }))}
          />
          Advanced
        </label>
      </div>
      <div className="editor-actions">
        <button className="mini-button" onClick={() => setDraft(cleanDraft)} disabled={!isDirty} data-testid="discard-field-draft">
          Discard
        </button>
        <button className="primary-button compact-button" onClick={() => onUpdate(fieldPatchFromDraft(field, draft))} disabled={!isDirty || !canSave} data-testid="save-field-draft">
          Save Field
        </button>
      </div>
    </section>
  );
}

function SchemaValidationPanel({ validation }: { validation: SchemaValidationResult }) {
  if (validation.valid && validation.warnings.length === 0) {
    return (
      <section className="schema-health valid">
        <CheckCircle2 size={15} />
        <span>Schema valid</span>
      </section>
    );
  }

  return (
    <section className={`schema-health ${validation.valid ? "warning" : "invalid"}`}>
      <AlertTriangle size={15} />
      <span>{validation.valid ? `${validation.warnings.length} review warning${validation.warnings.length === 1 ? "" : "s"}` : validation.errors[0]}</span>
    </section>
  );
}

function createFieldDraft(field: FieldSpec): FieldDraft {
  return {
    label: field.label,
    description: field.description ?? "",
    kind: field.kind,
    group: field.ui?.group ?? "",
    defaultValue: stringifyDefaultValue(field.defaultValue),
    placeholder: field.placeholder ?? "",
    choices: field.choices?.join(", ") ?? "",
    validationMin: field.validation?.min !== undefined ? String(field.validation.min) : "",
    validationMax: field.validation?.max !== undefined ? String(field.validation.max) : "",
    validationPattern: field.validation?.pattern ?? "",
    required: field.required,
    advanced: field.ui?.advanced === true
  };
}

function fieldPatchFromDraft(field: FieldSpec, draft: FieldDraft): Partial<FieldSpec> {
  const validation = validationFromDraft(draft);

  return {
    label: draft.label.trim(),
    description: draft.description.trim() || undefined,
    kind: draft.kind,
    required: draft.required,
    defaultValue: defaultValueFromDraft(draft),
    choices: choicesFromDraft(draft),
    placeholder: draft.placeholder.trim() || undefined,
    validation,
    ui: {
      ...field.ui,
      group: draft.group.trim() || undefined,
      advanced: draft.advanced,
      control: controlForKind(draft.kind, field.ui?.control)
    }
  };
}

function defaultValueFromDraft(draft: FieldDraft): FieldSpec["defaultValue"] | undefined {
  const raw = draft.defaultValue.trim();
  if (!raw) return undefined;
  if (draft.kind === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  if (draft.kind === "boolean") return raw === "true";
  if (draft.kind === "array" || draft.kind === "multi-file") {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return raw;
}

function validationFromDraft(draft: FieldDraft): FieldSpec["validation"] | undefined {
  const min = draft.validationMin.trim() === "" ? undefined : Number(draft.validationMin);
  const max = draft.validationMax.trim() === "" ? undefined : Number(draft.validationMax);
  const pattern = draft.validationPattern.trim() || undefined;
  const validation = {
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
    pattern
  };

  return validation.min !== undefined || validation.max !== undefined || validation.pattern ? validation : undefined;
}

function choicesFromDraft(draft: FieldDraft): string[] | undefined {
  const choices = draft.choices
    .split(",")
    .map((choice) => choice.trim())
    .filter(Boolean);
  return choices.length > 0 ? choices : undefined;
}

function controlForKind(kind: FieldKind, current?: FieldUiHints["control"]): FieldUiHints["control"] | undefined {
  if (kind === "boolean") return "switch";
  if (kind === "enum") return "select";
  if (kind === "number") return "number";
  if (kind === "file" || kind === "multi-file") return "file";
  return current === "switch" || current === "select" || current === "number" || current === "file" ? undefined : current;
}

function stringifyDefaultValue(value: FieldSpec["defaultValue"]): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function SchemaSourceView({ manifest }: { manifest: ToolManifest }) {
  return (
    <div className="schema-source-view">
      <details>
        <summary>Raw Help</summary>
        <pre>{manifest.rawHelp?.trim() || "No raw help stored."}</pre>
      </details>
      <details>
        <summary>Schema JSON</summary>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
    </div>
  );
}

function OutputConsole({
  lines,
  runs,
  activeTab,
  onTabChange,
  runState,
  onRerun,
  onRunSelect
}: {
  lines: ConsoleLine[];
  runs: StoredRun[];
  activeTab: "all" | "stdout" | "stderr";
  onTabChange: (tab: "all" | "stdout" | "stderr") => void;
  runState: RunState;
  onRerun: () => void;
  onRunSelect: (run: StoredRun) => void;
}) {
  const visibleLines = lines.filter((line) => activeTab === "all" || line.stream === activeTab || line.stream === "system");

  return (
    <section className="console-panel">
      <div className="console-toolbar">
        <div className="console-tabs">
          {(["all", "stdout", "stderr"] as const).map((tab) => (
            <button className={activeTab === tab ? "selected" : ""} onClick={() => onTabChange(tab)} key={tab}>
              {tab === "all" ? "Run History" : tab}
            </button>
          ))}
        </div>
        <div className="run-status">
          {runState.running ? <Clock3 size={15} /> : runState.exitCode === 0 ? <CheckCircle2 size={15} /> : <Terminal size={15} />}
          <span>
            {runState.running
              ? "running"
              : runState.durationMs !== null
                ? `exit ${runState.exitCode ?? "signal"} · ${runState.durationMs}ms`
                : "idle"}
          </span>
          <button className="icon-text-button" onClick={onRerun} disabled={runState.running || runState.command.length === 0}>
            <RotateCcw size={15} />
            Rerun
          </button>
        </div>
      </div>
      <div className="console-output" data-testid="console-output">
        {activeTab === "all" && runs.length > 0 ? (
          <div className="run-history-list">
            {runs.slice(0, 5).map((run) => (
              <button className="run-history-item" onClick={() => onRunSelect(run)} key={run.id}>
                <span>
                  <strong>{run.toolName}</strong>
                  <small>
                    exit {run.exitCode ?? "signal"} · {run.durationMs}ms · {new Date(run.completedAt).toLocaleTimeString()}
                  </small>
                </span>
                <code>{run.preview}</code>
              </button>
            ))}
          </div>
        ) : null}
        {visibleLines.map((line) => (
          <div className={`console-line ${line.stream}`} key={line.id}>
            <span>{new Date(line.at).toLocaleTimeString()}</span>
            <code>{line.stream}</code>
            <pre>{line.text}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function groupFields(fields: FieldSpec[]): Record<string, FieldSpec[]> {
  return fields.reduce<Record<string, FieldSpec[]>>((groups, field) => {
    const group = field.ui?.group ?? "Options";
    groups[group] ??= [];
    groups[group].push(field);
    return groups;
  }, {});
}

function reconcileValues(command: CommandSpec, current: FieldValues): FieldValues {
  const defaults = initialValuesFor(command);
  return Object.fromEntries(command.fields.map((field) => [field.id, current[field.id] ?? defaults[field.id]]));
}

function createConsoleLines(stream: ConsoleLine["stream"], text: string, at = new Date().toISOString()): ConsoleLine[] {
  const chunks = text.split(/\r?\n/).filter((line) => line.length > 0);
  return chunks.map((line) => ({
    id: createStorageId("line"),
    stream,
    text: line,
    at
  }));
}

function consoleLinesForRun(run: StoredRun): ConsoleLine[] {
  const summary = createConsoleLines("system", `Loaded saved run: ${run.preview}`, run.completedAt);
  const stdout = createConsoleLines("stdout", run.stdout, run.completedAt);
  const stderr = createConsoleLines("stderr", run.stderr, run.completedAt);

  if (stdout.length === 0 && stderr.length === 0) {
    return [...summary, ...createConsoleLines("system", "No output captured for this run.", run.completedAt)];
  }

  return [...summary, ...stdout, ...stderr];
}
