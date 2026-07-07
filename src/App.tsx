import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
import {
  cleanupProject as cleanupProjectData,
  createProject as createProjectData,
  deleteProject as deleteProjectData,
  detectAiProviders,
  discoverTool,
  exportProject as exportProjectData,
  loadProjectSnapshot,
  runCommandStream,
  saveProjectWorkspace,
  selectProject as selectProjectData,
  summarizeRunOutput as summarizeRunOutputWithAi,
  suggestSchemaPatch as suggestSchemaPatchWithAi
} from "./lib/api";
import { isAiEnabled, normalizeAiSettings, type AiCompletion, type AiProviderDetection, type AiSchemaSuggestion, type AiSettings } from "./lib/ai";
import { buildCommandPreview, buildRunRequest, initialValuesFor, type FieldValues } from "./lib/commandBuilder";
import { formatCommand } from "./lib/commandLine";
import { analyzeRunOutput, type OutputAnalysis, type OutputArtifact } from "./lib/outputAnalysis";
import type { ProjectSnapshot } from "./lib/projects";
import { parseEnvText, timeoutMsFromSeconds } from "./lib/runSettings";
import { sampleManifest } from "./lib/sampleData";
import { exportSchemaJson, importSchemaJson, schemaExportFilename } from "./lib/schemaTransfer";
import { adapterTrustKey, commandRiskReviewKey, detectCommandRisk, executablePinnedPath, schemaFingerprint, type CommandRisk } from "./lib/security";
import {
  appendAuditLog,
  appendPreset,
  appendRun,
  appendWorkflowRun,
  areAdaptersTrusted,
  createStorageId,
  createWorkspace,
  isExecutableTrusted,
  isSchemaTrusted,
  loadWorkspace,
  persistWorkspace,
  redactSecretValues,
  trustAdapter,
  trustExecutable,
  trustSchema,
  upsertManifest,
  upsertWorkflow,
  type SavedPreset,
  type AuditLogEntry,
  type StoredRun,
  type WorkspaceState
} from "./lib/storage";
import { confidenceLevel, type CommandSpec, type ExecutionMode, type FieldKind, type FieldSpec, type FieldUiHints, type RunEvent, type ToolManifest } from "./lib/schema";
import { isReviewField, validateToolManifest, type SchemaValidationResult } from "./lib/schemaValidation";
import {
  duplicateWorkflowPreset,
  firstArtifactToken,
  resolveWorkflowRunRequest,
  resolveWorkflowValues,
  workflowContextFromStepRun,
  workflowStatusFromStepRuns,
  type SavedWorkflow,
  type StoredWorkflowRun,
  type WorkflowStep,
  type WorkflowStepRun,
  type WorkflowStepStatus
} from "./lib/workflows";

type ConsoleLine = {
  id: string;
  stream: "system" | "stdout" | "stderr" | "terminal";
  text: string;
  at: string;
};

type ConsoleTab = "all" | "detail" | "artifacts" | "insights" | "terminal" | "stdout" | "stderr" | "audit";
type WorkspaceSection = "discover" | "tool-ui" | "schema" | "workflow" | "console";

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
  executionMode: ExecutionMode;
  stdout: string;
  stderr: string;
  startedAt: string;
  cwd?: string;
  envKeys?: string[];
};

type RunSettings = {
  cwd: string;
  envText: string;
  executionMode: ExecutionMode;
  timeoutSeconds: number;
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

type WorkflowRunState = {
  running: boolean;
  stepRuns: WorkflowStepRun[];
};

const FIELD_KINDS: FieldKind[] = ["string", "number", "boolean", "enum", "file", "directory", "multi-file", "secret", "array", "raw"];
const MAX_VISIBLE_FIELDS = 18;
const DEFAULT_RUN_SETTINGS: RunSettings = {
  cwd: "",
  envText: "",
  executionMode: "stream",
  timeoutSeconds: 120
};

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
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTab>("all");
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("tool-ui");
  const [selectedRun, setSelectedRun] = useState<StoredRun | null>(null);
  const [runSettings, setRunSettings] = useState<RunSettings>(DEFAULT_RUN_SETTINGS);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [aiDetections, setAiDetections] = useState<AiProviderDetection[]>([]);
  const [aiStatus, setAiStatus] = useState<string>("");
  const [schemaSuggestions, setSchemaSuggestions] = useState<AiSchemaSuggestion[]>([]);
  const [schemaSuggestionStatus, setSchemaSuggestionStatus] = useState<string>("");
  const [aiExplanation, setAiExplanation] = useState<AiCompletion | null>(null);
  const [aiExplaining, setAiExplaining] = useState(false);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [projectStatus, setProjectStatus] = useState("Loading project database...");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [workflowRunState, setWorkflowRunState] = useState<WorkflowRunState>({ running: false, stepRuns: [] });
  const [riskReviewKey, setRiskReviewKey] = useState("");
  const [clearWorkspaceArmed, setClearWorkspaceArmed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runCaptureRef = useRef<RunCapture | null>(null);
  const schemaFileInputRef = useRef<HTMLInputElement | null>(null);
  const discoveryInputRef = useRef<HTMLInputElement | null>(null);
  const discoverySectionRef = useRef<HTMLElement | null>(null);
  const toolUiSectionRef = useRef<HTMLElement | null>(null);
  const schemaSectionRef = useRef<HTMLElement | null>(null);
  const workflowSectionRef = useRef<HTMLElement | null>(null);
  const consoleSectionRef = useRef<HTMLElement | null>(null);

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
  const selectedWorkflow = useMemo(() => {
    return workspaceState.workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workspaceState.workflows[0] ?? null;
  }, [selectedWorkflowId, workspaceState.workflows]);
  const schemaValidation = useMemo(() => validateToolManifest(manifest), [manifest]);
  const pinnedExecutablePath = useMemo(() => executablePinnedPath(manifest), [manifest]);
  const manifestSchemaFingerprint = useMemo(() => schemaFingerprint(manifest), [manifest]);
  const executableTrusted = useMemo(
    () => isExecutableTrusted(workspaceState, manifest.executable, pinnedExecutablePath),
    [manifest.executable, pinnedExecutablePath, workspaceState]
  );
  const schemaTrusted = useMemo(
    () => manifest.source !== "imported" || isSchemaTrusted(workspaceState, manifestSchemaFingerprint),
    [manifest.source, manifestSchemaFingerprint, workspaceState]
  );
  const adaptersTrusted = useMemo(() => areAdaptersTrusted(workspaceState, manifest.adapters), [manifest.adapters, workspaceState]);
  const commandRisk = useMemo(() => {
    const request = buildRunRequest(manifest, selectedCommand, values);
    return detectCommandRisk(manifest, selectedCommand, [request.executable, ...request.baseArgs, ...request.args]);
  }, [manifest, selectedCommand, values]);
  const currentRiskReviewKey = useMemo(() => commandRiskReviewKey(manifest, selectedCommand, values), [manifest, selectedCommand, values]);
  const destructiveRiskReviewed = !commandRisk.destructive || riskReviewKey === currentRiskReviewKey;
  const canRunCommand = executableTrusted && schemaTrusted && adaptersTrusted && !commandRisk.requiresShell && destructiveRiskReviewed;

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

  useEffect(() => {
    if (selectedWorkflowId && workspaceState.workflows.some((workflow) => workflow.id === selectedWorkflowId)) return;
    setSelectedWorkflowId(workspaceState.workflows[0]?.id ?? "");
  }, [selectedWorkflowId, workspaceState.workflows]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";

      if (event.key === "/" && !editing) {
        event.preventDefault();
        navigateToSection("discover");
        discoveryInputRef.current?.focus();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!runState.running && canRunCommand) void handleRun();
        return;
      }

      if (event.key === "Escape" && (runState.running || workflowRunState.running)) {
        event.preventDefault();
        handleCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canRunCommand, runState.running, workflowRunState.running, manifest, selectedCommand, values, runSettings, workspaceState]);

  useEffect(() => {
    let canceled = false;

    async function loadProject() {
      try {
        const snapshot = await loadProjectSnapshot();
        if (canceled) return;

        setProjectSnapshot(snapshot);
        if (snapshot.workspace) {
          applyWorkspaceSnapshot(snapshot, snapshot.workspace);
        } else {
          const saved = await saveProjectWorkspace(workspaceState, snapshot.activeProjectId);
          if (canceled) return;
          setProjectSnapshot(saved);
          setProjectStatus(`Initialized ${projectName(saved)} in SQLite.`);
        }
      } catch (error) {
        if (canceled) return;
        setProjectStatus(error instanceof Error ? `SQLite unavailable: ${error.message}` : "SQLite unavailable. Using browser fallback.");
      }
    }

    void loadProject();
    return () => {
      canceled = true;
    };
  }, []);

  function commitWorkspace(updater: (current: WorkspaceState) => WorkspaceState) {
    setWorkspaceState((current) => {
      const next = updater(current);
      persistWorkspace(next);
      if (projectSnapshot) {
        void saveProjectWorkspace(next, projectSnapshot.activeProjectId)
          .then((snapshot) => {
            setProjectSnapshot((currentSnapshot) => (currentSnapshot?.activeProjectId === snapshot.activeProjectId ? snapshot : currentSnapshot));
            setProjectStatus(`Saved ${projectName(snapshot)} to SQLite.`);
          })
          .catch((error) => {
            setProjectStatus(error instanceof Error ? `SQLite save failed: ${error.message}` : "SQLite save failed.");
          });
      }
      return next;
    });
  }

  function navigateToSection(section: WorkspaceSection) {
    setActiveSection(section);
    const ref = {
      discover: discoverySectionRef,
      "tool-ui": toolUiSectionRef,
      schema: schemaSectionRef,
      workflow: workflowSectionRef,
      console: consoleSectionRef
    }[section];
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function audit(entry: Omit<Parameters<typeof appendAuditLog>[1], "id" | "at">) {
    commitWorkspace((current) =>
      appendAuditLog(current, {
        id: createStorageId("audit"),
        at: new Date().toISOString(),
        ...entry
      })
    );
  }

  function redactedPreviewFor(manifestForPreview: ToolManifest, command: CommandSpec, fieldValues: FieldValues): string {
    const redactedValues = redactSecretValues(command.fields, fieldValues, "[redacted]");
    const request = buildRunRequest(manifestForPreview, command, redactedValues);
    return formatCommand([request.executable, ...request.baseArgs, ...request.args]);
  }

  function blockRun(reason: string, action: "run.blocked" | "workflow.blocked" = "run.blocked", details?: { workflowId?: string; preview?: string }) {
    appendConsole("stderr", reason);
    audit({
      action,
      toolId: manifest.id,
      commandId: selectedCommand.id,
      workflowId: details?.workflowId,
      executable: manifest.executable,
      preview: details?.preview ?? redactedPreviewFor(manifest, selectedCommand, values),
      reason
    });
  }

  function handleSaveAiSettings(settings: AiSettings) {
    const normalized = normalizeAiSettings(settings);
    commitWorkspace((current) => ({ ...current, aiSettings: normalized }));
    setAiStatus(normalized.mode === "none" ? "AI disabled. Deterministic mode is active." : `Saved ${normalized.mode} settings.`);
  }

  async function handleDetectAiProviders() {
    setAiStatus("Detecting local AI providers...");
    try {
      const detections = await detectAiProviders();
      setAiDetections(detections);
      const available = detections.filter((item) => item.available);
      setAiStatus(available.length > 0 ? `Detected ${available.length} local provider${available.length === 1 ? "" : "s"}.` : "No local AI providers detected.");
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : "Provider detection failed.");
    }
  }

  async function handleRequestSchemaSuggestions() {
    if (!isAiEnabled(workspaceState.aiSettings)) {
      setSchemaSuggestionStatus("Enable a local AI provider in Settings before requesting suggestions.");
      return;
    }

    setSchemaSuggestionStatus("Requesting reviewable schema suggestions...");
    try {
      const result = await suggestSchemaPatchWithAi(workspaceState.aiSettings, manifest);
      setSchemaSuggestions(result.suggestions);
      setSchemaSuggestionStatus(
        result.suggestions.length > 0
          ? `${result.suggestions.length} suggestion${result.suggestions.length === 1 ? "" : "s"} ready for review.`
          : "Provider returned no applicable schema suggestions."
      );
    } catch (error) {
      setSchemaSuggestionStatus(error instanceof Error ? error.message : "Schema suggestion failed.");
    }
  }

  function handleApplySchemaSuggestion(suggestion: AiSchemaSuggestion) {
    commitWorkspace((current) => {
      const now = new Date().toISOString();
      return {
        ...current,
        manifests: current.manifests.map((tool) => {
          if (tool.id !== manifest.id) return tool;

          return {
            ...tool,
            source: "ai-enhanced",
            updatedAt: now,
            commands: tool.commands.map((command) => {
              if (command.id !== suggestion.commandId) return command;

              return {
                ...command,
                fields: command.fields.map((field) => {
                  if (field.id !== suggestion.fieldId) return field;
                  return {
                    ...field,
                    label: suggestion.label ?? field.label,
                    description: suggestion.description ?? field.description,
                    ui: suggestion.group ? { ...field.ui, group: suggestion.group } : field.ui
                  };
                })
              };
            })
          };
        })
      };
    });
    setSchemaSuggestions((current) => current.filter((item) => item !== suggestion));
    appendConsole("system", `Applied AI schema suggestion for ${suggestion.fieldId}.`);
  }

  function handleDismissSchemaSuggestion(suggestion: AiSchemaSuggestion) {
    setSchemaSuggestions((current) => current.filter((item) => item !== suggestion));
  }

  async function handleExplainOutput(stdout: string, stderr: string, analysis: OutputAnalysis) {
    if (!isAiEnabled(workspaceState.aiSettings)) {
      setAiExplanation({
        provider: "none",
        model: "",
        text: "AI is disabled. Enable a local provider in Settings to explain captured output.",
        createdAt: new Date().toISOString()
      });
      return;
    }

    setAiExplaining(true);
    try {
      const result = await summarizeRunOutputWithAi({
        settings: workspaceState.aiSettings,
        command: runState.command.length > 0 ? formatCommand(runState.command) : commandPreview,
        stdout,
        stderr,
        analysis
      });
      setAiExplanation(result);
    } catch (error) {
      setAiExplanation({
        provider: workspaceState.aiSettings.mode,
        model: workspaceState.aiSettings.model,
        text: error instanceof Error ? error.message : "AI output explanation failed.",
        createdAt: new Date().toISOString()
      });
    } finally {
      setAiExplaining(false);
    }
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
    if (!executableTrusted) {
      blockRun(`Trust ${manifest.executable} before running local commands.`);
      return;
    }
    if (!schemaTrusted) {
      blockRun(`Review and trust the imported schema for ${manifest.name} before running it.`);
      return;
    }
    if (!adaptersTrusted) {
      blockRun(`Trust the applied adapter metadata for ${manifest.name} before running it.`);
      return;
    }
    if (commandRisk.requiresShell) {
      blockRun("Shell mode is gated in this build. This command cannot run until it is represented as argv-safe fields.");
      return;
    }
    if (commandRisk.destructive && !destructiveRiskReviewed) {
      blockRun("Review and acknowledge the destructive-command warning before running.");
      return;
    }

    let env: Record<string, string> | undefined;
    try {
      env = parseEnvText(runSettings.envText);
    } catch (error) {
      blockRun(error instanceof Error ? error.message : "Invalid environment settings.");
      return;
    }

    const runOptions = {
      cwd: runSettings.cwd.trim() || undefined,
      env,
      executionMode: runSettings.executionMode,
      pty: runSettings.executionMode === "pty" ? { cols: 120, rows: 30 } : undefined,
      timeoutMs: timeoutMsFromSeconds(runSettings.timeoutSeconds)
    };
    const request = buildRunRequest(manifest, selectedCommand, values, runOptions);
    const redactedValues = redactSecretValues(selectedCommand.fields, values, "[redacted]");
    const redactedRequest = buildRunRequest(manifest, selectedCommand, redactedValues, runOptions);
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
      executionMode: request.executionMode ?? "stream",
      stdout: "",
      stderr: "",
      startedAt: new Date().toISOString(),
      cwd: request.cwd,
      envKeys: request.env ? Object.keys(request.env).sort() : undefined
    };
    setRunState({ running: true, exitCode: null, durationMs: null, command: actualCommand });
    setSelectedRun(null);
    appendConsole("system", `Running ${formatCommand(redactedCommand)}`);
    audit({
      action: "run.started",
      toolId: manifest.id,
      commandId: selectedCommand.id,
      executable: manifest.executable,
      preview: formatCommand(redactedCommand),
        metadata: {
          executionMode: request.executionMode ?? "stream",
          importedSchema: manifest.source === "imported",
          destructive: commandRisk.destructive,
        warningCount: commandRisk.warnings.length
      }
    });

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

  function handleCreateWorkflow() {
    const now = new Date().toISOString();
    const workflow: SavedWorkflow = {
      id: createStorageId("workflow"),
      name: `Workflow ${workspaceState.workflows.length + 1}`,
      steps: [],
      createdAt: now,
      updatedAt: now
    };
    commitWorkspace((current) => upsertWorkflow(current, workflow));
    setSelectedWorkflowId(workflow.id);
    setWorkflowRunState({ running: false, stepRuns: [] });
    appendConsole("system", `Created workflow "${workflow.name}".`);
  }

  function handleAddCurrentStepToWorkflow() {
    const now = new Date().toISOString();
    const workflow =
      selectedWorkflow ??
      ({
        id: createStorageId("workflow"),
        name: "Local workflow",
        steps: [],
        createdAt: now,
        updatedAt: now
      } satisfies SavedWorkflow);
    const step: WorkflowStep = {
      id: createStorageId("step"),
      name: `${manifest.name} ${selectedCommand.name}`,
      toolId: manifest.id,
      commandId: selectedCommand.id,
      values: redactSecretValues(selectedCommand.fields, values),
      runSettings: {
        cwd: runSettings.cwd.trim() || undefined,
        envText: runSettings.envText.trim() || undefined,
        executionMode: runSettings.executionMode,
        timeoutSeconds: runSettings.timeoutSeconds
      }
    };
    const nextWorkflow: SavedWorkflow = {
      ...workflow,
      steps: [...workflow.steps, step],
      updatedAt: now
    };

    commitWorkspace((current) => upsertWorkflow(current, nextWorkflow));
    setSelectedWorkflowId(nextWorkflow.id);
    setWorkflowRunState({ running: false, stepRuns: [] });
    appendConsole("system", `Added step "${step.name}" to ${nextWorkflow.name}.`);
  }

  function handleRemoveWorkflowStep(stepId: string) {
    if (!selectedWorkflow) return;
    const nextWorkflow: SavedWorkflow = {
      ...selectedWorkflow,
      steps: selectedWorkflow.steps.filter((step) => step.id !== stepId),
      updatedAt: new Date().toISOString()
    };
    commitWorkspace((current) => upsertWorkflow(current, nextWorkflow));
    setWorkflowRunState({ running: false, stepRuns: [] });
  }

  function handleRenameWorkflow(name: string) {
    if (!selectedWorkflow) return;
    const nextWorkflow: SavedWorkflow = {
      ...selectedWorkflow,
      name,
      updatedAt: new Date().toISOString()
    };
    commitWorkspace((current) => upsertWorkflow(current, nextWorkflow));
  }

  function handleRenameWorkflowStep(stepId: string, name: string) {
    if (!selectedWorkflow) return;
    const nextWorkflow: SavedWorkflow = {
      ...selectedWorkflow,
      steps: selectedWorkflow.steps.map((step) => (step.id === stepId ? { ...step, name } : step)),
      updatedAt: new Date().toISOString()
    };
    commitWorkspace((current) => upsertWorkflow(current, nextWorkflow));
  }

  function handleDuplicateWorkflowPreset() {
    if (!selectedWorkflow) return;
    const duplicated = duplicateWorkflowPreset(selectedWorkflow, {
      idFor: createStorageId,
      now: new Date().toISOString()
    });
    commitWorkspace((current) => upsertWorkflow(current, duplicated));
    setSelectedWorkflowId(duplicated.id);
    setWorkflowRunState({ running: false, stepRuns: [] });
    appendConsole("system", `Saved workflow preset "${duplicated.name}".`);
  }

  async function handleCopyWorkflowToken(token: string) {
    try {
      await copyTextToClipboard(token);
      appendConsole("system", `Copied workflow token ${token}.`);
    } catch {
      appendConsole("stderr", `Clipboard unavailable. Token: ${token}`);
    }
  }

  async function handleRunWorkflow(mode: "all" | "next") {
    if (!selectedWorkflow || workflowRunState.running) return;
    if (selectedWorkflow.steps.length === 0) {
      appendConsole("stderr", "Add at least one workflow step before running.");
      return;
    }

    const existingStepRuns = mode === "next" ? workflowRunState.stepRuns : [];
    const startIndex = mode === "next" ? existingStepRuns.length : 0;
    const stepsToRun = selectedWorkflow.steps.slice(startIndex);
    if (stepsToRun.length === 0) {
      appendConsole("system", "Workflow has no remaining steps.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = new Date().toISOString();
    let stepRuns = [...existingStepRuns];
    const contexts = stepRuns.map(workflowContextFromStepRun);
    setWorkflowRunState({ running: true, stepRuns });
    appendConsole("system", `Running workflow "${selectedWorkflow.name}" ${mode === "next" ? "one step" : "from the first step"}.`);
    audit({
      action: "workflow.started",
      workflowId: selectedWorkflow.id,
      outcome: mode,
      metadata: {
        stepCount: stepsToRun.length
      }
    });

    try {
      for (const step of stepsToRun) {
        const stepRun = await runWorkflowStep(selectedWorkflow, step, contexts, controller.signal);
        stepRuns = [...stepRuns.filter((current) => current.stepId !== step.id), stepRun];
        contexts.push(workflowContextFromStepRun(stepRun));

        if (stepRun.status !== "succeeded") break;
      }
    } finally {
      const completedAt = new Date().toISOString();
      const status = workflowStatusFromStepRuns(stepRuns);
      setWorkflowRunState({ running: false, stepRuns });
      abortRef.current = null;
      commitWorkspace((current) =>
        appendAuditLog(
          appendWorkflowRun(current, {
            id: createStorageId("workflow-run"),
            workflowId: selectedWorkflow.id,
            workflowName: selectedWorkflow.name,
            status,
            stepRuns,
            startedAt,
            completedAt
          }),
          {
            id: createStorageId("audit"),
            at: completedAt,
            action: "workflow.completed",
            workflowId: selectedWorkflow.id,
            outcome: status,
            metadata: {
              stepCount: stepRuns.length
            }
          }
        )
      );
      appendConsole("system", `Workflow "${selectedWorkflow.name}" ${status}.`);
    }
  }

  async function runWorkflowStep(
    workflow: SavedWorkflow,
    step: WorkflowStep,
    contexts: ReturnType<typeof workflowContextFromStepRun>[],
    signal: AbortSignal
  ): Promise<WorkflowStepRun> {
    const stepManifest = workspaceState.manifests.find((tool) => tool.id === step.toolId);
    const stepCommand = stepManifest?.commands.find((command) => command.id === step.commandId);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const failStep = (message: string, details?: { toolId?: string; commandId?: string; executable?: string; preview?: string }) => {
      audit({
        action: "workflow.blocked",
        toolId: details?.toolId,
        commandId: details?.commandId,
        workflowId: workflow.id,
        executable: details?.executable,
        preview: details?.preview,
        reason: message
      });
      return createFailedWorkflowStepRun(step, message, startedAt, startedMs);
    };

    if (!stepManifest || !stepCommand) {
      return failStep("Workflow step references a tool or command that no longer exists.");
    }

    const stepPinnedPath = executablePinnedPath(stepManifest);
    if (!isExecutableTrusted(workspaceState, stepManifest.executable, stepPinnedPath)) {
      return failStep(`Trust ${stepManifest.executable} before running workflow step "${step.name}".`, {
        toolId: stepManifest.id,
        commandId: stepCommand.id,
        executable: stepManifest.executable
      });
    }
    const stepSchemaFingerprint = schemaFingerprint(stepManifest);
    if (stepManifest.source === "imported" && !isSchemaTrusted(workspaceState, stepSchemaFingerprint)) {
      return failStep(`Review and trust the imported schema before running workflow step "${step.name}".`, {
        toolId: stepManifest.id,
        commandId: stepCommand.id,
        executable: stepManifest.executable
      });
    }
    if (!areAdaptersTrusted(workspaceState, stepManifest.adapters)) {
      return failStep(`Trust adapter metadata before running workflow step "${step.name}".`, {
        toolId: stepManifest.id,
        commandId: stepCommand.id,
        executable: stepManifest.executable
      });
    }

    let env: Record<string, string> | undefined;
    try {
      env = parseEnvText(step.runSettings?.envText ?? "");
    } catch (error) {
      return failStep(error instanceof Error ? error.message : "Invalid workflow step environment.", {
        toolId: stepManifest.id,
        commandId: stepCommand.id,
        executable: stepManifest.executable
      });
    }

    const resolvedValues = resolveWorkflowValues(step.values, contexts);
    const redactedValues = resolveWorkflowValues(redactSecretValues(stepCommand.fields, step.values, "[redacted]"), contexts);
      const runOptions = {
        cwd: step.runSettings?.cwd?.trim() || undefined,
        env,
        executionMode: step.runSettings?.executionMode ?? "stream",
        pty: step.runSettings?.executionMode === "pty" ? { cols: 120, rows: 30 } : undefined,
        timeoutMs: timeoutMsFromSeconds(step.runSettings?.timeoutSeconds ?? DEFAULT_RUN_SETTINGS.timeoutSeconds)
      };
    const request = resolveWorkflowRunRequest(buildRunRequest(stepManifest, stepCommand, resolvedValues, runOptions), contexts);
    const redactedRequest = resolveWorkflowRunRequest(buildRunRequest(stepManifest, stepCommand, redactedValues, runOptions), contexts);
    const actualCommand = [request.executable, ...request.baseArgs, ...request.args];
    const redactedCommand = [redactedRequest.executable, ...redactedRequest.baseArgs, ...redactedRequest.args];
    const stepRisk = detectCommandRisk(stepManifest, stepCommand, actualCommand);
    if (stepRisk.requiresShell) {
      return failStep("Shell mode is gated in this build. Workflow step cannot run.", {
        toolId: stepManifest.id,
        commandId: stepCommand.id,
        executable: stepManifest.executable,
        preview: formatCommand(redactedCommand)
      });
    }
    if (stepRisk.destructive) {
      return failStep("Destructive workflow steps require direct command review before workflow execution.", {
        toolId: stepManifest.id,
        commandId: stepCommand.id,
        executable: stepManifest.executable,
        preview: formatCommand(redactedCommand)
      });
    }
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let signalName: string | null = null;
    let timedOut = false;
    let durationMs = 0;

    upsertLiveWorkflowStep({
      stepId: step.id,
      stepName: step.name,
      command: redactedCommand,
      preview: formatCommand(redactedCommand),
      executionMode: request.executionMode ?? "stream",
      status: "running",
      exitCode: null,
      durationMs: 0,
      stdout,
      stderr,
      startedAt,
      completedAt: startedAt
    });

    appendConsole("system", `Workflow ${workflow.name}: running ${step.name}`);
    audit({
      action: "run.started",
      toolId: stepManifest.id,
      commandId: stepCommand.id,
      workflowId: workflow.id,
      executable: stepManifest.executable,
      preview: formatCommand(redactedCommand),
      metadata: {
        workflowStep: true,
        warningCount: stepRisk.warnings.length
      }
    });

    try {
      await runCommandStream(
        request,
        (event) => {
          if (event.type === "stdout") {
            stdout += event.chunk;
            updateLiveWorkflowStepOutput(step.id, stdout, stderr);
            return;
          }
          if (event.type === "terminal") {
            stdout += event.chunk;
            updateLiveWorkflowStepOutput(step.id, stdout, stderr);
            return;
          }
          if (event.type === "stderr") {
            stderr += event.chunk;
            updateLiveWorkflowStepOutput(step.id, stdout, stderr);
            return;
          }
          if (event.type === "error") {
            stderr += event.message;
            updateLiveWorkflowStepOutput(step.id, stdout, stderr);
            return;
          }
          if (event.type === "exit") {
            exitCode = event.exitCode;
            signalName = event.signal;
            timedOut = event.timedOut === true;
            durationMs = event.durationMs;
          }
        },
        signal
      );
    } catch (error) {
      stderr += signal.aborted ? "Workflow canceled by user." : error instanceof Error ? error.message : "Workflow step failed.";
      durationMs = Date.now() - startedMs;
    }

    const outputAnalysis = analyzeRunOutput(stdout, stderr);
    const status: WorkflowStepStatus = exitCode === 0 && !timedOut && !stderr.includes("Workflow canceled by user.") ? "succeeded" : "failed";
    const completedAt = new Date().toISOString();
    const stepRun: WorkflowStepRun = {
      stepId: step.id,
      stepName: step.name,
      command: redactedCommand,
      preview: formatCommand(redactedCommand),
      status,
      exitCode,
      signal: signalName,
      durationMs,
      timedOut,
      outputAnalysis,
      stdout,
      stderr,
      startedAt,
      completedAt
    };
    upsertLiveWorkflowStep(stepRun);
    audit({
      action: "run.completed",
      toolId: stepManifest.id,
      commandId: stepCommand.id,
      workflowId: workflow.id,
      executable: stepManifest.executable,
      preview: formatCommand(redactedCommand),
      outcome: status,
      metadata: {
        workflowStep: true,
        exitCode: exitCode ?? undefined,
        durationMs
      }
    });
    return stepRun;
  }

  function createFailedWorkflowStepRun(step: WorkflowStep, message: string, startedAt: string, startedMs: number): WorkflowStepRun {
    const completedAt = new Date().toISOString();
    const stepRun: WorkflowStepRun = {
      stepId: step.id,
      stepName: step.name,
      command: [],
      preview: "",
      status: "failed",
      exitCode: null,
      durationMs: Date.now() - startedMs,
      stderr: message,
      stdout: "",
      startedAt,
      completedAt
    };
    upsertLiveWorkflowStep(stepRun);
    appendConsole("stderr", message);
    return stepRun;
  }

  function upsertLiveWorkflowStep(stepRun: WorkflowStepRun) {
    setWorkflowRunState((current) => ({
      ...current,
      stepRuns: [...current.stepRuns.filter((step) => step.stepId !== stepRun.stepId), stepRun]
    }));
  }

  function updateLiveWorkflowStepOutput(stepId: string, stdout: string, stderr: string) {
    setWorkflowRunState((current) => ({
      ...current,
      stepRuns: current.stepRuns.map((step) => (step.stepId === stepId ? { ...step, stdout, stderr } : step))
    }));
  }

  function handleCancel() {
    abortRef.current?.abort();
    setRunState((state) => ({ ...state, running: false }));
    setWorkflowRunState((state) => ({ ...state, running: false }));
  }

  function handleTrustExecutable() {
    const now = new Date().toISOString();
    commitWorkspace((current) =>
      appendAuditLog(
        trustExecutable(current, {
          executable: manifest.executable,
          name: manifest.name,
          source: manifest.source === "imported" ? "imported" : "user",
          pinnedPath: pinnedExecutablePath,
          resolutionType: manifest.discovery?.resolution.type,
          trustedAt: now
        }),
        {
          id: createStorageId("audit"),
          at: now,
          action: "trust.executable",
          toolId: manifest.id,
          executable: manifest.executable,
          metadata: {
            pinned: pinnedExecutablePath ? true : false
          }
        }
      )
    );
    appendConsole("system", `Trusted executable for local runs: ${pinnedExecutablePath ?? manifest.executable}`);
  }

  function handleTrustSchema() {
    const now = new Date().toISOString();
    commitWorkspace((current) =>
      appendAuditLog(
        trustSchema(current, {
          fingerprint: manifestSchemaFingerprint,
          toolId: manifest.id,
          name: manifest.name,
          source: manifest.source,
          trustedAt: now
        }),
        {
          id: createStorageId("audit"),
          at: now,
          action: "trust.schema",
          toolId: manifest.id,
          executable: manifest.executable,
          metadata: {
            imported: manifest.source === "imported"
          }
        }
      )
    );
    appendConsole("system", `Trusted schema for ${manifest.name}: ${manifestSchemaFingerprint}`);
  }

  function handleTrustAdapters() {
    const now = new Date().toISOString();
    commitWorkspace((current) => {
      const withAdapters = (manifest.adapters ?? []).reduce(
        (state, adapter) =>
          trustAdapter(state, {
            id: adapter.id,
            name: adapter.name,
            version: adapter.version,
            trustedAt: now
          }),
        current
      );
      return appendAuditLog(withAdapters, {
        id: createStorageId("audit"),
        at: now,
        action: "trust.adapter",
        toolId: manifest.id,
        executable: manifest.executable,
        metadata: {
          count: manifest.adapters?.length ?? 0
        }
      });
    });
    appendConsole("system", `Trusted adapter metadata for ${manifest.adapters?.map(adapterTrustKey).join(", ") || manifest.name}.`);
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

    if (event.type === "terminal") {
      if (runCaptureRef.current) {
        runCaptureRef.current.stdout += event.chunk;
      }
      appendConsole("terminal", event.chunk);
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
    appendConsole("system", `${event.timedOut ? "Timed out" : "Exited"} with code ${event.exitCode ?? event.signal ?? "signal"} in ${event.durationMs}ms.`);

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
        executionMode: capture.executionMode,
        exitCode: event.exitCode,
        signal: event.signal,
        durationMs: event.durationMs,
        timedOut: event.timedOut,
        cwd: capture.cwd,
        envKeys: capture.envKeys,
        outputAnalysis: analyzeRunOutput(capture.stdout, capture.stderr),
        stdout: capture.stdout,
        stderr: capture.stderr,
        startedAt: capture.startedAt,
        completedAt: event.at
      };
      commitWorkspace((current) =>
        appendAuditLog(appendRun(current, storedRun), {
          id: createStorageId("audit"),
          at: event.at,
          action: "run.completed",
          toolId: capture.toolId,
          commandId: capture.commandId,
          executable: capture.command[0],
          preview: capture.preview,
          outcome: event.timedOut ? "timed_out" : event.exitCode === 0 ? "succeeded" : "failed",
          metadata: {
            executionMode: capture.executionMode,
            exitCode: event.exitCode ?? undefined,
            durationMs: event.durationMs
          }
        })
      );
      setSelectedRun(storedRun);
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
    setPresetNameDraft("");
    setClearWorkspaceArmed(false);
  }

  function handleSelectCommand(commandId: string) {
    const nextCommand = manifest.commands.find((command) => command.id === commandId);
    if (!nextCommand) return;

    setSelectedCommandId(nextCommand.id);
    setSelectedFieldId(nextCommand.fields[0]?.id ?? null);
    setValues(initialValuesFor(nextCommand));
    setPresetNameDraft("");
  }

  async function handleCreateProject() {
    const name = window.prompt("Project name", `Project ${(projectSnapshot?.projects.length ?? 0) + 1}`)?.trim();
    if (!name) return;

    try {
      const created = await createProjectData(name);
      const workspace = createWorkspace(sampleManifest);
      const saved = await saveProjectWorkspace(workspace, created.activeProjectId);
      applyWorkspaceSnapshot(saved, workspace);
      appendConsole("system", `Created project "${projectName(saved)}".`);
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Project creation failed.");
    }
  }

  async function handleSelectProject(projectId: string) {
    try {
      const selected = await selectProjectData(projectId);
      if (selected.workspace) {
        applyWorkspaceSnapshot(selected, selected.workspace);
        appendConsole("system", `Opened project "${projectName(selected)}".`);
        return;
      }

      const workspace = createWorkspace(sampleManifest);
      const saved = await saveProjectWorkspace(workspace, selected.activeProjectId);
      applyWorkspaceSnapshot(saved, workspace);
      appendConsole("system", `Initialized project "${projectName(saved)}".`);
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Project selection failed.");
    }
  }

  async function handleDeleteProject() {
    if (!projectSnapshot || projectSnapshot.projects.length <= 1) {
      appendConsole("stderr", "Cannot delete the last project.");
      return;
    }

    const activeProject = projectSnapshot.projects.find((project) => project.id === projectSnapshot.activeProjectId);
    const name = activeProject?.name ?? "current project";
    if (!window.confirm(`Delete "${name}" and its local data? This cannot be undone.`)) return;

    try {
      const snapshot = await deleteProjectData(projectSnapshot.activeProjectId);
      const workspace = snapshot.workspace ?? createWorkspace(sampleManifest);
      applyWorkspaceSnapshot(snapshot, workspace);
      appendConsole("system", `Deleted project "${name}".`);
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Project deletion failed.");
    }
  }

  async function handleExportProject() {
    try {
      const exported = await exportProjectData(projectSnapshot?.activeProjectId);
      const filename = `${sanitizeFilename(exported.project.name)}.givemeui.project.json`;
      downloadText(filename, JSON.stringify(exported, null, 2));
      appendConsole("system", `Exported project backup ${filename}.`);
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Project export failed.");
    }
  }

  async function handleCleanupProject() {
    try {
      const result = await cleanupProjectData(projectSnapshot?.activeProjectId);
      const snapshot = await loadProjectSnapshot();
      if (snapshot.workspace) {
        applyWorkspaceSnapshot(snapshot, snapshot.workspace);
      } else {
        setProjectSnapshot(snapshot);
      }
      appendConsole(
        "system",
        `Cleaned project data: ${result.runsRemoved} runs, ${result.workflowRunsRemoved} workflow runs, ${result.auditEntriesRemoved} audit records removed.`
      );
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Project cleanup failed.");
    }
  }

  async function handleClearWorkspace() {
    if (!clearWorkspaceArmed) {
      setClearWorkspaceArmed(true);
      appendConsole("system", "Click Confirm Clear to reset the active workspace to a blank slate.");
      return;
    }

    const workspace = createWorkspace(sampleManifest);
    const nextManifest = workspace.manifests[0] ?? sampleManifest;
    const nextCommand = nextManifest.commands[0] ?? sampleManifest.commands[0];
    const line: ConsoleLine = {
      id: createStorageId("line"),
      stream: "system",
      text: "Workspace cleared. Blank slate ready.",
      at: new Date().toISOString()
    };

    abortRef.current?.abort();
    abortRef.current = null;
    runCaptureRef.current = null;
    persistWorkspace(workspace);
    setWorkspaceState(workspace);
    setSelectedCommandId(nextCommand.id);
    setSelectedFieldId(nextCommand.fields[0]?.id ?? null);
    setValues(initialValuesFor(nextCommand));
    setShowAdvanced(false);
    setSelectedWorkflowId("");
    setWorkflowRunState({ running: false, stepRuns: [] });
    setSelectedRun(null);
    setConsoleLines([line]);
    setRunState({ running: false, exitCode: null, durationMs: null, command: [] });
    setRunSettings(DEFAULT_RUN_SETTINGS);
    setPresetNameDraft("");
    setSchemaSuggestions([]);
    setSchemaSuggestionStatus("");
    setAiExplanation(null);
    setAiExplaining(false);
    setRiskReviewKey("");
    setActiveConsoleTab("all");
    setActiveSection("tool-ui");
    setClearWorkspaceArmed(false);

    if (!projectSnapshot) {
      setProjectStatus("Cleared browser workspace.");
      return;
    }

    try {
      const saved = await saveProjectWorkspace(workspace, projectSnapshot.activeProjectId);
      setProjectSnapshot(saved);
      setProjectStatus(`Cleared ${projectName(saved)} in SQLite.`);
    } catch (error) {
      setProjectStatus(error instanceof Error ? `SQLite clear failed: ${error.message}` : "SQLite clear failed.");
    }
  }

  function applyWorkspaceSnapshot(snapshot: ProjectSnapshot, workspace: WorkspaceState) {
    setProjectSnapshot(snapshot);
    setWorkspaceState(workspace);
    persistWorkspace(workspace);
    const nextManifest = workspace.manifests.find((tool) => tool.id === workspace.activeToolId) ?? workspace.manifests[0] ?? sampleManifest;
    const nextCommand = nextManifest.commands[0] ?? sampleManifest.commands[0];
    setSelectedCommandId(nextCommand.id);
    setSelectedFieldId(nextCommand.fields[0]?.id ?? null);
    setValues(initialValuesFor(nextCommand));
    setPresetNameDraft("");
    setClearWorkspaceArmed(false);
    setWorkflowRunState({ running: false, stepRuns: [] });
    setProjectStatus(`Loaded ${projectName(snapshot)} from SQLite.`);
  }

  function handleNewTool() {
    setCommandInput("");
    navigateToSection("discover");
    window.setTimeout(() => discoveryInputRef.current?.focus(), 0);
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
    const name = presetNameDraft.trim() || suggestedName;
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
    setPresetNameDraft("");
    appendConsole("system", `Saved preset "${name}".`);
  }

  function handleLoadPreset(presetId: string) {
    const preset = workspaceState.presets.find((item) => item.id === presetId);
    if (!preset) return;

    setValues(reconcileValues(selectedCommand, preset.values));
    appendConsole("system", `Loaded preset "${preset.name}".`);
  }

  async function handleExportSchema() {
    const json = exportSchemaJson(manifest);
    const filename = schemaExportFilename(manifest);
    downloadText(filename, json);

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(json);
      appendConsole("system", `Exported ${filename} and copied schema JSON to clipboard.`);
    } catch {
      appendConsole("system", `Exported ${filename}. Clipboard copy is unavailable in this browser.`);
    }
  }

  function handleImportSchema() {
    const pasted = window.prompt("Paste a ToolManifest JSON object");
    if (!pasted) return;

    importSchemaText(pasted);
  }

  async function handleImportSchemaFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      importSchemaText(await file.text());
    } catch (error) {
      appendConsole("stderr", error instanceof Error ? error.message : "Schema file import failed.");
    }
  }

  function importSchemaText(input: string) {
    try {
      const { manifest: imported, validation } = importSchemaJson(input);
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
    setSelectedRun(run);
    setConsoleLines(consoleLinesForRun(run));
    setRunState({
      running: false,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      command: run.command
    });
    setActiveConsoleTab("detail");
    navigateToSection("console");
  }

  function appendConsole(stream: ConsoleLine["stream"], text: string) {
    setConsoleLines((current) => [...current, ...createConsoleLines(stream, text)]);
  }

  return (
    <main className="app-shell">
      <Sidebar
        activeSection={activeSection}
        activeToolId={manifest.id}
        aiSettings={workspaceState.aiSettings}
        manifests={workspaceState.manifests}
        projectSnapshot={projectSnapshot}
        projectStatus={projectStatus}
        runCount={workspaceState.runs.length}
        clearWorkspaceArmed={clearWorkspaceArmed}
        onCleanupProject={() => void handleCleanupProject()}
        onCreateProject={() => void handleCreateProject()}
        onDeleteProject={() => void handleDeleteProject()}
        onExportProject={() => void handleExportProject()}
        onClearWorkspace={() => void handleClearWorkspace()}
        onNewTool={handleNewTool}
        onNavigateSection={navigateToSection}
        onSelectProject={(projectId) => void handleSelectProject(projectId)}
        onSelectManifest={handleSelectManifest}
        onSettings={() => setShowAiSettings(true)}
        onShowRuns={() => {
          setActiveConsoleTab("all");
          navigateToSection("console");
        }}
      />
      <section className="workspace">
        <DiscoveryBar
          sectionRef={discoverySectionRef}
          inputRef={discoveryInputRef}
          commandInput={commandInput}
          isDiscovering={isDiscovering}
          onCommandInputChange={setCommandInput}
          onDiscover={handleDiscover}
        />
        <div className="work-grid">
          <section className="primary-panel" ref={toolUiSectionRef}>
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
              adapters={manifest.adapters}
              adaptersTrusted={adaptersTrusted}
              canRun={canRunCommand}
              commandRisk={commandRisk}
              executable={manifest.executable}
              isTrusted={executableTrusted}
              pinnedPath={pinnedExecutablePath}
              presets={commandPresets}
              preview={commandPreview}
              presetNameDraft={presetNameDraft}
              runSettings={runSettings}
              runState={runState}
              schemaFingerprint={manifestSchemaFingerprint}
              schemaRequiresTrust={manifest.source === "imported"}
              schemaTrusted={schemaTrusted}
              destructiveRiskReviewed={destructiveRiskReviewed}
              onDestructiveRiskReviewChange={(reviewed) => setRiskReviewKey(reviewed ? currentRiskReviewKey : "")}
              onCancel={handleCancel}
              onLoadPreset={handleLoadPreset}
              onPresetNameChange={setPresetNameDraft}
              onRun={handleRun}
              onRunSettingsChange={setRunSettings}
              onSavePreset={handleSavePreset}
              onTrustAdapters={handleTrustAdapters}
              onTrustExecutable={handleTrustExecutable}
              onTrustSchema={handleTrustSchema}
            />
          </section>
          <aside className="inspector-panel" ref={schemaSectionRef}>
            <PanelHeader
              icon={<FileJson2 size={17} />}
              title="Schema Review"
              subtitle="Editable schema draft"
              action={
                <div className="schema-actions">
                  <input
                    ref={schemaFileInputRef}
                    aria-label="Import schema JSON file"
                    className="schema-file-input"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void handleImportSchemaFile(event)}
                  />
                  <button className="mini-button" onClick={() => schemaFileInputRef.current?.click()}>
                    Import File
                  </button>
                  <button className="mini-button" onClick={handleImportSchema}>
                    Paste
                  </button>
                  <button className="mini-button" onClick={() => void handleExportSchema()}>
                    Export
                  </button>
                </div>
              }
            />
            <ToolDiscoveryPanel manifest={manifest} />
            <SchemaSummary fields={selectedCommand.fields} stats={fieldStats} />
            <AiSchemaReviewPanel
              command={selectedCommand}
              settings={workspaceState.aiSettings}
              status={schemaSuggestionStatus}
              suggestions={schemaSuggestions}
              onApply={handleApplySchemaSuggestion}
              onDismiss={handleDismissSchemaSuggestion}
              onRequest={handleRequestSchemaSuggestions}
            />
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
        <WorkflowBuilderPanel
          sectionRef={workflowSectionRef}
          workflows={workspaceState.workflows}
          workflowRuns={workspaceState.workflowRuns}
          selectedWorkflow={selectedWorkflow}
          liveRunState={workflowRunState}
          manifests={workspaceState.manifests}
          onAddCurrentStep={handleAddCurrentStepToWorkflow}
          onCreateWorkflow={handleCreateWorkflow}
          onDuplicateWorkflow={handleDuplicateWorkflowPreset}
          onCopyToken={(token) => void handleCopyWorkflowToken(token)}
          onRemoveStep={handleRemoveWorkflowStep}
          onRenameStep={handleRenameWorkflowStep}
          onRenameWorkflow={handleRenameWorkflow}
          onRunAll={() => void handleRunWorkflow("all")}
          onRunNext={() => void handleRunWorkflow("next")}
          onSelectWorkflow={(workflowId) => {
            setSelectedWorkflowId(workflowId);
            setWorkflowRunState({ running: false, stepRuns: [] });
          }}
        />
        <OutputConsole
          sectionRef={consoleSectionRef}
          activeTab={activeConsoleTab}
          aiExplanation={aiExplanation}
          aiExplaining={aiExplaining}
          aiSettings={workspaceState.aiSettings}
          auditLog={workspaceState.auditLog}
          lines={consoleLines}
          runs={workspaceState.runs}
          runState={runState}
          selectedRun={selectedRun}
          onExplainOutput={handleExplainOutput}
          onRerun={handleRun}
          onRunSelect={handleSelectRun}
          onTabChange={setActiveConsoleTab}
        />
      </section>
      {showAiSettings ? (
        <AiSettingsPanel
          detections={aiDetections}
          settings={workspaceState.aiSettings}
          status={aiStatus}
          onClose={() => setShowAiSettings(false)}
          onDetect={() => void handleDetectAiProviders()}
          onSave={handleSaveAiSettings}
        />
      ) : null}
    </main>
  );
}

function Sidebar({
  activeSection,
  activeToolId,
  aiSettings,
  manifests,
  projectSnapshot,
  projectStatus,
  runCount,
  clearWorkspaceArmed,
  onCleanupProject,
  onClearWorkspace,
  onCreateProject,
  onDeleteProject,
  onExportProject,
  onNavigateSection,
  onNewTool,
  onSelectProject,
  onSelectManifest,
  onSettings,
  onShowRuns
}: {
  activeSection: WorkspaceSection;
  activeToolId: string;
  aiSettings: AiSettings;
  manifests: ToolManifest[];
  projectSnapshot: ProjectSnapshot | null;
  projectStatus: string;
  runCount: number;
  clearWorkspaceArmed: boolean;
  onCleanupProject: () => void;
  onClearWorkspace: () => void;
  onCreateProject: () => void;
  onDeleteProject: () => void;
  onExportProject: () => void;
  onNavigateSection: (section: WorkspaceSection) => void;
  onNewTool: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectManifest: (toolId: string) => void;
  onSettings: () => void;
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

      <section className="sidebar-section project-section">
        <div className="section-label">Project</div>
        <select
          className="project-select"
          aria-label="Project"
          value={projectSnapshot?.activeProjectId ?? ""}
          onChange={(event) => event.target.value && onSelectProject(event.target.value)}
        >
          {projectSnapshot?.projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          )) ?? <option value="">Loading project</option>}
        </select>
        <div className="project-actions">
          <button className="mini-button" onClick={onCreateProject}>
            New
          </button>
          <button className="mini-button" onClick={onExportProject} disabled={!projectSnapshot}>
            Export
          </button>
          <button className="mini-button" onClick={onCleanupProject} disabled={!projectSnapshot}>
            Clean
          </button>
          <button className={`mini-button ${clearWorkspaceArmed ? "danger-mini" : ""}`} onClick={onClearWorkspace}>
            {clearWorkspaceArmed ? "Confirm Clear" : "Clear"}
          </button>
          <button className="mini-button danger-mini" onClick={onDeleteProject} disabled={!projectSnapshot || projectSnapshot.projects.length <= 1}>
            Delete
          </button>
        </div>
        <small className="project-status">{projectStatus}</small>
      </section>

      <nav className="sidebar-section screen-nav">
        <div className="section-label">Screens</div>
        {[
          { id: "discover", label: "Discover", icon: <Search size={15} /> },
          { id: "tool-ui", label: "Tool UI", icon: <Wrench size={15} /> },
          { id: "schema", label: "Schema", icon: <FileJson2 size={15} /> },
          { id: "workflow", label: "Workflows", icon: <History size={15} /> },
          { id: "console", label: "Output", icon: <Terminal size={15} /> }
        ].map((item) => (
          <button
            className={`screen-nav-button ${activeSection === item.id ? "selected" : ""}`}
            key={item.id}
            onClick={() => onNavigateSection(item.id as WorkspaceSection)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

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
          <span>{aiSettings.mode === "none" ? "AI Optional" : `AI ${aiSettings.mode}`}</span>
        </div>
        <button className="icon-text-button" data-testid="ai-settings-button" onClick={onSettings}>
          <Settings2 size={15} />
          Settings
        </button>
      </div>
    </aside>
  );
}

function DiscoveryBar({
  sectionRef,
  inputRef,
  commandInput,
  isDiscovering,
  onCommandInputChange,
  onDiscover
}: {
  sectionRef: RefObject<HTMLElement>;
  inputRef: RefObject<HTMLInputElement>;
  commandInput: string;
  isDiscovering: boolean;
  onCommandInputChange: (value: string) => void;
  onDiscover: () => void;
}) {
  return (
    <header className="discovery-bar" ref={sectionRef}>
      <div className="command-search">
        <Search size={17} />
        <input
          ref={inputRef}
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

function AiSettingsPanel({
  detections,
  settings,
  status,
  onClose,
  onDetect,
  onSave
}: {
  detections: AiProviderDetection[];
  settings: AiSettings;
  status: string;
  onClose: () => void;
  onDetect: () => void;
  onSave: (settings: AiSettings) => void;
}) {
  const [draft, setDraft] = useState<AiSettings>(() => normalizeAiSettings(settings));

  useEffect(() => {
    setDraft(normalizeAiSettings(settings));
  }, [settings]);

  function updateMode(mode: AiSettings["mode"]) {
    setDraft(normalizeAiSettings({ ...draft, mode, endpoint: "", model: "" }));
  }

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true">
      <section className="settings-panel">
        <div className="settings-header">
          <span>
            <strong>AI Settings</strong>
            <small>Optional local enhancement layer</small>
          </span>
          <button className="mini-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="settings-body">
          <label className="editor-field">
            <span>Provider</span>
            <select value={draft.mode} onChange={(event) => updateMode(event.target.value as AiSettings["mode"])}>
              <option value="none">None - deterministic only</option>
              <option value="ollama">Ollama - local</option>
              <option value="lm-studio">LM Studio - local</option>
              <option value="local-openai-compatible">OpenAI-compatible local server</option>
              <option value="openai">OpenAI cloud - later</option>
            </select>
          </label>
          <label className="editor-field">
            <span>Endpoint</span>
            <input value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} />
          </label>
          <label className="editor-field">
            <span>Model</span>
            <input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} />
          </label>
          <div className="settings-actions">
            <button className="secondary-button compact-button" onClick={onDetect}>
              Detect Local Providers
            </button>
            <button className="primary-button compact-button" onClick={() => onSave(draft)}>
              Save Settings
            </button>
          </div>
          {status ? <div className="ai-status-line">{status}</div> : null}
          {detections.length > 0 ? (
            <div className="provider-detection-list">
              {detections.map((detection) => (
                <button
                  className={`provider-detection ${detection.available ? "available" : ""}`}
                  key={`${detection.mode}-${detection.endpoint}`}
                  onClick={() =>
                    detection.available
                      ? setDraft(
                          normalizeAiSettings({
                            mode: detection.mode,
                            endpoint: detection.endpoint,
                            model: detection.models[0] ?? ""
                          })
                        )
                      : undefined
                  }
                >
                  <strong>{detection.label}</strong>
                  <small>{detection.available ? `${detection.models.length || 1} model${detection.models.length === 1 ? "" : "s"}` : detection.error}</small>
                  <code>{detection.endpoint}</code>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
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
  adapters,
  adaptersTrusted,
  canRun,
  commandRisk,
  executable,
  isTrusted,
  pinnedPath,
  presets,
  preview,
  presetNameDraft,
  runSettings,
  schemaFingerprint,
  schemaRequiresTrust,
  schemaTrusted,
  destructiveRiskReviewed,
  onRun,
  onCancel,
  onSavePreset,
  onLoadPreset,
  onPresetNameChange,
  onRunSettingsChange,
  onTrustAdapters,
  onTrustExecutable,
  onTrustSchema,
  onDestructiveRiskReviewChange,
  runState
}: {
  adapters?: ToolManifest["adapters"];
  adaptersTrusted: boolean;
  canRun: boolean;
  commandRisk: CommandRisk;
  executable: string;
  isTrusted: boolean;
  pinnedPath?: string;
  presets: SavedPreset[];
  preview: string;
  presetNameDraft: string;
  runSettings: RunSettings;
  schemaFingerprint: string;
  schemaRequiresTrust: boolean;
  schemaTrusted: boolean;
  destructiveRiskReviewed: boolean;
  onRun: () => void;
  onCancel: () => void;
  onSavePreset: () => void;
  onLoadPreset: (presetId: string) => void;
  onPresetNameChange: (value: string) => void;
  onRunSettingsChange: (settings: RunSettings) => void;
  onTrustAdapters: () => void;
  onTrustExecutable: () => void;
  onTrustSchema: () => void;
  onDestructiveRiskReviewChange: (reviewed: boolean) => void;
  runState: RunState;
}) {
  const adapterLabel = adapters?.map(adapterTrustKey).join(", ");
  const trustBlocked = !isTrusted || !schemaTrusted || !adaptersTrusted || commandRisk.requiresShell || (commandRisk.destructive && !destructiveRiskReviewed);

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
            <input
              aria-label="Preset name"
              className="preset-name-input"
              value={presetNameDraft}
              placeholder="Preset name"
              onChange={(event) => onPresetNameChange(event.target.value)}
            />
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
            <button className="primary-button" data-testid="run-command" onClick={onRun} disabled={runState.running || !canRun}>
              <Play size={16} />
              Run
            </button>
          </div>
        </div>
      </div>
      <pre>{preview}</pre>
      <div className={`run-safety-panel ${isTrusted ? "trusted" : "untrusted"}`}>
        <div>
          <strong>{isTrusted ? "Trusted executable" : "Trust required"}</strong>
          <code>{pinnedPath ?? executable}</code>
        </div>
        {isTrusted ? (
          <span>{runSettings.executionMode === "pty" ? "pty terminal" : "argument-array execution"}</span>
        ) : (
          <button className="secondary-button compact-button" data-testid="trust-executable" onClick={onTrustExecutable}>
            Trust Executable
          </button>
        )}
      </div>
      {schemaRequiresTrust || adapters?.length ? (
        <div className="trust-stack">
          {schemaRequiresTrust ? (
            <div className={`trust-row ${schemaTrusted ? "trusted" : "untrusted"}`}>
              <div>
                <strong>{schemaTrusted ? "Trusted imported schema" : "Imported schema review required"}</strong>
                <code>{schemaFingerprint}</code>
              </div>
              {schemaTrusted ? <span>reviewed</span> : <button className="secondary-button compact-button" onClick={onTrustSchema}>Trust Schema</button>}
            </div>
          ) : null}
          {adapters?.length ? (
            <div className={`trust-row ${adaptersTrusted ? "trusted" : "untrusted"}`}>
              <div>
                <strong>{adaptersTrusted ? "Trusted adapter metadata" : "Adapter trust required"}</strong>
                <code>{adapterLabel}</code>
              </div>
              {adaptersTrusted ? <span>reviewed</span> : <button className="secondary-button compact-button" onClick={onTrustAdapters}>Trust Adapters</button>}
            </div>
          ) : null}
        </div>
      ) : null}
      {commandRisk.warnings.length > 0 || commandRisk.destructive || commandRisk.requiresShell ? (
        <div className={`run-risk-panel ${commandRisk.requiresShell || commandRisk.destructive ? "warning" : ""}`}>
          <div className="run-risk-heading">
            <AlertTriangle size={15} />
            <strong>{commandRisk.requiresShell ? "Shell mode gated" : commandRisk.destructive ? "Destructive command warning" : "Command review note"}</strong>
          </div>
          {commandRisk.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {commandRisk.destructive && !commandRisk.requiresShell ? (
            <label className="inline-check risk-ack">
              <input type="checkbox" checked={destructiveRiskReviewed} onChange={(event) => onDestructiveRiskReviewChange(event.target.checked)} />
              I reviewed this destructive command preview
            </label>
          ) : null}
        </div>
      ) : null}
      {trustBlocked ? <p className="run-block-note">Run is disabled until all trust and safety gates pass.</p> : null}
      <div className="run-settings-grid">
        <label className="run-setting-field mode-field">
          <span>Execution</span>
          <div className="execution-mode-options" role="group" aria-label="Execution mode">
            <button
              type="button"
              className={runSettings.executionMode === "stream" ? "selected" : ""}
              onClick={() => onRunSettingsChange({ ...runSettings, executionMode: "stream" })}
            >
              Stream
            </button>
            <button
              type="button"
              className={runSettings.executionMode === "pty" ? "selected" : ""}
              onClick={() => onRunSettingsChange({ ...runSettings, executionMode: "pty" })}
            >
              PTY
            </button>
          </div>
        </label>
        <label className="run-setting-field">
          <span>Working Directory</span>
          <input
            data-testid="run-cwd"
            value={runSettings.cwd}
            placeholder="Use GIVEMEUI process directory"
            onChange={(event) => onRunSettingsChange({ ...runSettings, cwd: event.target.value })}
          />
        </label>
        <label className="run-setting-field">
          <span>Timeout Seconds</span>
          <input
            data-testid="run-timeout"
            type="number"
            min={1}
            max={1800}
            value={runSettings.timeoutSeconds}
            onChange={(event) => onRunSettingsChange({ ...runSettings, timeoutSeconds: Number(event.target.value) })}
          />
        </label>
        <label className="run-setting-field env-field">
          <span>Environment</span>
          <textarea
            data-testid="run-env"
            value={runSettings.envText}
            placeholder="KEY=value"
            onChange={(event) => onRunSettingsChange({ ...runSettings, envText: event.target.value })}
          />
        </label>
      </div>
    </section>
  );
}

function WorkflowBuilderPanel({
  sectionRef,
  workflows,
  workflowRuns,
  selectedWorkflow,
  liveRunState,
  manifests,
  onAddCurrentStep,
  onCreateWorkflow,
  onCopyToken,
  onDuplicateWorkflow,
  onRemoveStep,
  onRenameStep,
  onRenameWorkflow,
  onRunAll,
  onRunNext,
  onSelectWorkflow
}: {
  sectionRef: RefObject<HTMLElement>;
  workflows: SavedWorkflow[];
  workflowRuns: StoredWorkflowRun[];
  selectedWorkflow: SavedWorkflow | null;
  liveRunState: WorkflowRunState;
  manifests: ToolManifest[];
  onAddCurrentStep: () => void;
  onCreateWorkflow: () => void;
  onCopyToken: (token: string) => void;
  onDuplicateWorkflow: () => void;
  onRemoveStep: (stepId: string) => void;
  onRenameStep: (stepId: string, name: string) => void;
  onRenameWorkflow: (name: string) => void;
  onRunAll: () => void;
  onRunNext: () => void;
  onSelectWorkflow: (workflowId: string) => void;
}) {
  const latestStoredRun = selectedWorkflow ? workflowRuns.find((run) => run.workflowId === selectedWorkflow.id) : undefined;
  const displayStepRuns = liveRunState.stepRuns.length > 0 ? liveRunState.stepRuns : latestStoredRun?.stepRuns ?? [];
  const completedCount = displayStepRuns.filter((run) => run.status === "succeeded").length;
  const nextStep = selectedWorkflow?.steps[completedCount];

  return (
    <section className="workflow-panel" data-testid="workflow-builder" ref={sectionRef}>
      <PanelHeader
        icon={<History size={17} />}
        title="Workflow Builder"
        subtitle="Sequential local command chains"
        action={
          <div className="workflow-actions">
            <select
              className="command-select"
              aria-label="Workflow"
              value={selectedWorkflow?.id ?? ""}
              onChange={(event) => onSelectWorkflow(event.target.value)}
            >
              {workflows.length === 0 ? <option value="">No workflows</option> : null}
              {workflows.map((workflow) => (
                <option value={workflow.id} key={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
            <button className="mini-button" data-testid="new-workflow" onClick={onCreateWorkflow}>
              New
            </button>
            <button className="mini-button" data-testid="duplicate-workflow" onClick={onDuplicateWorkflow} disabled={!selectedWorkflow}>
              Save As Preset
            </button>
            <button className="mini-button" data-testid="add-workflow-step" onClick={onAddCurrentStep}>
              Add Current Command
            </button>
            <button className="secondary-button compact-button" data-testid="run-next-workflow-step" onClick={onRunNext} disabled={!selectedWorkflow || liveRunState.running}>
              Run Next
            </button>
            <button className="primary-button compact-button" data-testid="run-workflow" onClick={onRunAll} disabled={!selectedWorkflow || liveRunState.running}>
              <Play size={15} />
              Run All
            </button>
          </div>
        }
      />
      {!selectedWorkflow ? (
        <div className="workflow-empty">
          <Terminal size={22} />
          <strong>No workflow selected</strong>
          <span>Add the current command to start a local workflow.</span>
        </div>
      ) : (
        <div className="workflow-grid">
          <div className="workflow-steps">
            <div className="workflow-section-header">
              <input
                aria-label="Workflow name"
                className="workflow-name-input"
                value={selectedWorkflow.name}
                onChange={(event) => onRenameWorkflow(event.target.value)}
              />
              <small>{selectedWorkflow.steps.length} step{selectedWorkflow.steps.length === 1 ? "" : "s"}</small>
            </div>
            {selectedWorkflow.steps.length === 0 ? (
              <div className="workflow-empty compact">
                <span>Use Add Current Command to capture the active tool, command, values, and run settings.</span>
              </div>
            ) : null}
            {selectedWorkflow.steps.map((step, index) => {
              const stepManifest = manifests.find((tool) => tool.id === step.toolId);
              const stepCommand = stepManifest?.commands.find((command) => command.id === step.commandId);
              const stepRun = displayStepRuns.find((run) => run.stepId === step.id);
              const status = stepRun?.status ?? (nextStep?.id === step.id ? "pending" : index < completedCount ? "succeeded" : "pending");
              return (
                <article className="workflow-step" key={step.id}>
                  <div className="workflow-step-main">
                    <span className="workflow-step-index">{index + 1}</span>
                    <div>
                      <input
                        aria-label={`Step ${index + 1} name`}
                        className="workflow-step-name-input"
                        value={step.name}
                        onChange={(event) => onRenameStep(step.id, event.target.value)}
                      />
                      <small>
                        {stepManifest?.name ?? "Missing tool"} / {stepCommand?.name ?? "missing command"}
                      </small>
                      <span className="workflow-token-row">
                        <code>{firstArtifactToken(step.id)}</code>
                        <button className="mini-button" onClick={() => onCopyToken(firstArtifactToken(step.id))}>
                          Copy Token
                        </button>
                      </span>
                    </div>
                  </div>
                  <div className="workflow-step-side">
                    <WorkflowStatusPill status={status} />
                    <button className="mini-button" onClick={() => onRemoveStep(step.id)} disabled={liveRunState.running}>
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="workflow-run-log">
            <div className="workflow-section-header">
              <strong>Step Logs And Artifacts</strong>
              <small>{latestStoredRun ? `Last saved run: ${latestStoredRun.status}` : "No saved workflow runs yet"}</small>
            </div>
            {displayStepRuns.length === 0 ? (
              <div className="workflow-empty compact">
                <span>Run a step to capture per-step stdout, stderr, and artifact paths.</span>
              </div>
            ) : null}
            {displayStepRuns.map((stepRun) => (
              <details className="workflow-run-step" key={stepRun.stepId} open={stepRun.status === "failed" || stepRun.status === "running"}>
                <summary>
                  <span>
                    <strong>{stepRun.stepName}</strong>
                    <small>{stepRun.durationMs}ms · exit {stepRun.exitCode ?? "n/a"}</small>
                  </span>
                  <WorkflowStatusPill status={stepRun.status} />
                </summary>
                {stepRun.preview ? <pre>{stepRun.preview}</pre> : null}
                {stepRun.outputAnalysis?.artifacts.length ? (
                  <div className="workflow-artifacts">
                    {stepRun.outputAnalysis.artifacts.map((artifact) => (
                      <code key={`${stepRun.stepId}-${artifact.path}`}>{artifact.path}</code>
                    ))}
                  </div>
                ) : null}
                {stepRun.stdout ? (
                  <pre className="workflow-stream stdout">{stepRun.stdout}</pre>
                ) : null}
                {stepRun.stderr ? (
                  <pre className="workflow-stream stderr">{stepRun.stderr}</pre>
                ) : null}
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function WorkflowStatusPill({ status }: { status: WorkflowStepStatus }) {
  const tone = status === "succeeded" ? "success" : status === "failed" ? "danger" : "warning";
  return <span className={`workflow-status ${tone}`}>{status}</span>;
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
  const adapterLabels = manifest.adapters?.map((adapter) => adapter.name).join(", ");
  const adapterVersions = manifest.adapters
    ?.map((adapter) => [adapter.name, adapter.version].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");

  if (!discovery) {
    return (
      <section className="discovery-metadata">
        <div className="metadata-row">
          <span>Executable</span>
          <code>{manifest.executable}</code>
        </div>
        {adapterLabels ? (
          <div className="metadata-row">
            <span>Adapter</span>
            <code>{adapterLabels}</code>
          </div>
        ) : null}
        {adapterVersions ? (
          <div className="metadata-row">
            <span>Adapter Ver</span>
            <code>{adapterVersions}</code>
          </div>
        ) : null}
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
      {adapterLabels ? (
        <div className="metadata-row">
          <span>Adapter</span>
          <code>{adapterLabels}</code>
        </div>
      ) : null}
      {adapterVersions ? (
        <div className="metadata-row">
          <span>Adapter Ver</span>
          <code>{adapterVersions}</code>
        </div>
      ) : null}
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

function AiSchemaReviewPanel({
  command,
  settings,
  status,
  suggestions,
  onApply,
  onDismiss,
  onRequest
}: {
  command: CommandSpec;
  settings: AiSettings;
  status: string;
  suggestions: AiSchemaSuggestion[];
  onApply: (suggestion: AiSchemaSuggestion) => void;
  onDismiss: (suggestion: AiSchemaSuggestion) => void;
  onRequest: () => void;
}) {
  return (
    <section className="ai-review-panel">
      <div className="ai-review-header">
        <span>
          <strong>AI Schema Review</strong>
          <small>{settings.mode === "none" ? "disabled" : `${settings.mode} · ${settings.model}`}</small>
        </span>
        <button className="mini-button" onClick={onRequest} disabled={settings.mode === "none"}>
          Suggest
        </button>
      </div>
      {status ? <div className="ai-status-line">{status}</div> : null}
      {suggestions.length > 0 ? (
        <div className="ai-suggestion-list">
          {suggestions.map((suggestion) => {
            const field = command.fields.find((item) => item.id === suggestion.fieldId);
            return (
              <div className="ai-suggestion-item" key={`${suggestion.commandId}-${suggestion.fieldId}-${suggestion.reason}`}>
                <div>
                  <strong>{field?.label ?? suggestion.fieldId}</strong>
                  <small>{suggestion.reason}</small>
                </div>
                <dl>
                  {suggestion.label ? (
                    <>
                      <dt>Label</dt>
                      <dd>
                        {field?.label ?? ""} {"->"} {suggestion.label}
                      </dd>
                    </>
                  ) : null}
                  {suggestion.description ? (
                    <>
                      <dt>Description</dt>
                      <dd>{suggestion.description}</dd>
                    </>
                  ) : null}
                  {suggestion.group ? (
                    <>
                      <dt>Group</dt>
                      <dd>
                        {field?.ui?.group ?? "Options"} {"->"} {suggestion.group}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <div className="ai-suggestion-actions">
                  <button className="mini-button" onClick={() => onDismiss(suggestion)}>
                    Dismiss
                  </button>
                  <button className="primary-button compact-button" onClick={() => onApply(suggestion)}>
                    Apply
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
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
  sectionRef,
  lines,
  runs,
  auditLog,
  activeTab,
  aiExplanation,
  aiExplaining,
  aiSettings,
  onTabChange,
  runState,
  selectedRun,
  onExplainOutput,
  onRerun,
  onRunSelect
}: {
  sectionRef: RefObject<HTMLElement>;
  lines: ConsoleLine[];
  runs: StoredRun[];
  auditLog: AuditLogEntry[];
  activeTab: ConsoleTab;
  aiExplanation: AiCompletion | null;
  aiExplaining: boolean;
  aiSettings: AiSettings;
  onTabChange: (tab: ConsoleTab) => void;
  runState: RunState;
  selectedRun: StoredRun | null;
  onExplainOutput: (stdout: string, stderr: string, analysis: OutputAnalysis) => void;
  onRerun: () => void;
  onRunSelect: (run: StoredRun) => void;
}) {
  const visibleLines = lines.filter((line) => activeTab === "all" || line.stream === activeTab || line.stream === "system");
  const renderedLines = visibleLines.slice(-500);
  const hiddenLineCount = Math.max(0, visibleLines.length - renderedLines.length);
  const stdout = useMemo(() => lines.filter((line) => line.stream === "stdout" || line.stream === "terminal").map((line) => line.text).join("\n"), [lines]);
  const stderr = useMemo(() => lines.filter((line) => line.stream === "stderr").map((line) => line.text).join("\n"), [lines]);
  const outputAnalysis = useMemo(() => analyzeRunOutput(stdout, stderr), [stdout, stderr]);
  const detailRun = selectedRun ?? runs[0] ?? null;
  const artifactAnalysis = detailRun?.outputAnalysis ?? outputAnalysis;

  return (
    <section className="console-panel" ref={sectionRef}>
      <div className="console-toolbar">
        <div className="console-tabs">
          {(["all", "detail", "artifacts", "insights", "terminal", "stdout", "stderr", "audit"] as const).map((tab) => (
            <button className={activeTab === tab ? "selected" : ""} onClick={() => onTabChange(tab)} key={tab}>
              {tab === "all"
                ? "Run History"
                : tab === "detail"
                  ? "Run Detail"
                  : tab === "artifacts"
                    ? "Artifacts"
                    : tab === "insights"
                      ? "Insights"
                      : tab === "terminal"
                        ? "Terminal"
                        : tab === "audit"
                          ? "Audit"
                          : tab}
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
        {activeTab === "insights" ? (
          <OutputInsights
            aiExplanation={aiExplanation}
            aiExplaining={aiExplaining}
            aiSettings={aiSettings}
            analysis={outputAnalysis}
            stdout={stdout}
            stderr={stderr}
            onExplain={() => onExplainOutput(stdout, stderr, outputAnalysis)}
          />
        ) : null}
        {activeTab === "detail" ? <RunDetailPanel run={detailRun} /> : null}
        {activeTab === "artifacts" ? <ArtifactsPanel analysis={artifactAnalysis} /> : null}
        {activeTab === "all" && runs.length > 0 ? (
          <div className="run-history-list">
            {runs.slice(0, 5).map((run) => (
              <button className="run-history-item" onClick={() => onRunSelect(run)} key={run.id}>
                <span>
                  <strong>{run.toolName}</strong>
                  <small>
                    {run.timedOut ? "timeout" : `exit ${run.exitCode ?? run.signal ?? "signal"}`} · {run.durationMs}ms · {new Date(run.completedAt).toLocaleTimeString()}
                  </small>
                </span>
                <code>{run.preview}</code>
                {run.outputAnalysis ? (
                  <span className="run-analysis-badges">
                    {run.outputAnalysis.format !== "text" ? <b>{run.outputAnalysis.format}</b> : null}
                    {run.outputAnalysis.summary.errorCount > 0 ? <b className="error">{run.outputAnalysis.summary.errorCount} errors</b> : null}
                    {run.outputAnalysis.summary.artifactCount > 0 ? <b>{run.outputAnalysis.summary.artifactCount} files</b> : null}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        {activeTab === "audit" ? (
          <div className="audit-list" data-testid="audit-log">
            {auditLog.length > 0 ? (
              auditLog.slice(0, 20).map((entry) => (
                <div className="audit-item" key={entry.id}>
                  <span>{new Date(entry.at).toLocaleTimeString()}</span>
                  <code>{entry.action}</code>
                  <strong>{entry.outcome ?? entry.reason ?? entry.executable ?? entry.toolId ?? "recorded"}</strong>
                  {entry.preview ? <pre>{entry.preview}</pre> : null}
                </div>
              ))
            ) : (
              <div className="empty-state compact">No audit records yet.</div>
            )}
          </div>
        ) : null}
        {activeTab !== "insights" && activeTab !== "audit" && activeTab !== "detail" && activeTab !== "artifacts" ? (
          <>
            {hiddenLineCount > 0 ? <div className="console-trim-note">{hiddenLineCount} older lines hidden in this view.</div> : null}
            {renderedLines.map((line) => (
              <div className={`console-line ${line.stream}`} key={line.id}>
                <span>{new Date(line.at).toLocaleTimeString()}</span>
                <code>{line.stream}</code>
                <pre className={diagnosticClassFor(line.text)}>{line.text}</pre>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

function RunDetailPanel({ run }: { run: StoredRun | null }) {
  if (!run) {
    return (
      <div className="run-detail-empty">
        <Terminal size={22} />
        <span>No run selected.</span>
      </div>
    );
  }

  return (
    <div className="run-detail-panel" data-testid="run-detail">
      <div className="run-detail-header">
        <span>
          <strong>{run.toolName}</strong>
          <small>{run.commandName}</small>
        </span>
        <StatusPill label={run.timedOut ? "Timeout" : run.exitCode === 0 ? "Succeeded" : "Review"} tone={run.exitCode === 0 && !run.timedOut ? "success" : "warning"} />
      </div>
      <dl className="run-detail-grid">
        <div>
          <dt>Execution</dt>
          <dd>{run.executionMode ?? "stream"}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{new Date(run.completedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{run.durationMs}ms</dd>
        </div>
        <div>
          <dt>Exit</dt>
          <dd>{run.exitCode ?? run.signal ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Artifacts</dt>
          <dd>{run.outputAnalysis?.summary.artifactCount ?? 0}</dd>
        </div>
        {run.cwd ? (
          <div>
            <dt>CWD</dt>
            <dd>{run.cwd}</dd>
          </div>
        ) : null}
        {run.envKeys?.length ? (
          <div>
            <dt>Env Keys</dt>
            <dd>{run.envKeys.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      <pre className="run-detail-preview">{run.preview}</pre>
    </div>
  );
}

function ArtifactsPanel({ analysis }: { analysis: OutputAnalysis }) {
  return (
    <div className="artifacts-panel" data-testid="artifacts-viewer">
      {analysis.artifacts.length > 0 ? (
        analysis.artifacts.map((artifact) => <ArtifactRow artifact={artifact} key={`${artifact.path}-${artifact.line}`} />)
      ) : (
        <div className="run-detail-empty">
          <FileJson2 size={22} />
          <span>No artifacts detected.</span>
        </div>
      )}
    </div>
  );
}

function OutputInsights({
  aiExplanation,
  aiExplaining,
  aiSettings,
  analysis,
  stdout,
  stderr,
  onExplain
}: {
  aiExplanation: AiCompletion | null;
  aiExplaining: boolean;
  aiSettings: AiSettings;
  analysis: OutputAnalysis;
  stdout: string;
  stderr: string;
  onExplain: () => void;
}) {
  const combinedOutput = [stdout, stderr].filter(Boolean).join("\n");

  return (
    <div className="output-insights" data-testid="output-insights">
      <div className="insight-summary">
        <InsightStat label="Format" value={analysis.format.toUpperCase()} />
        <InsightStat label="Errors" value={String(analysis.summary.errorCount)} tone={analysis.summary.errorCount > 0 ? "error" : undefined} />
        <InsightStat label="Warnings" value={String(analysis.summary.warningCount)} tone={analysis.summary.warningCount > 0 ? "warning" : undefined} />
        <InsightStat label="Artifacts" value={String(analysis.summary.artifactCount)} />
        <div className="insight-actions">
          <button className="mini-button dark" onClick={() => void copyText(combinedOutput)} disabled={!combinedOutput}>
            Copy Output
          </button>
          <button className="mini-button dark" onClick={() => downloadText("givemeui-output.txt", combinedOutput)} disabled={!combinedOutput}>
            Download
          </button>
          <button className="mini-button dark" onClick={onExplain} disabled={!combinedOutput || aiExplaining}>
            {aiExplaining ? "Explaining" : aiSettings.mode === "none" ? "AI Disabled" : "Explain Output"}
          </button>
        </div>
      </div>

      {aiExplanation ? (
        <section className="insight-block ai-explanation">
          <div className="insight-block-header">
            <strong>AI Explanation</strong>
            <small>
              {aiExplanation.provider === "none" ? "disabled" : `${aiExplanation.provider} · ${aiExplanation.model}`}
            </small>
          </div>
          <pre>{aiExplanation.text}</pre>
        </section>
      ) : null}

      {analysis.json ? (
        <section className="insight-block">
          <div className="insight-block-header">
            <strong>{analysis.json.ndjson ? "NDJSON" : "JSON"}</strong>
            <button className="mini-button dark" onClick={() => void copyText(analysis.json?.pretty ?? "")}>
              Copy JSON
            </button>
          </div>
          <pre className="json-viewer">{analysis.json.pretty}</pre>
        </section>
      ) : null}

      {analysis.table ? (
        <section className="insight-block">
          <div className="insight-block-header">
            <strong>{analysis.format.toUpperCase()} Table</strong>
            <button className="mini-button dark" onClick={() => void copyText(tableToText(analysis.table?.headers ?? [], analysis.table?.rows ?? []))}>
              Copy Table
            </button>
          </div>
          <div className="table-viewer">
            <table>
              <thead>
                <tr>
                  {analysis.table.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.table.rows.slice(0, 12).map((row, rowIndex) => (
                  <tr key={`${row.join("-")}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${cell}-${cellIndex}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {analysis.table.truncated ? <small>Showing first 100 parsed rows.</small> : null}
        </section>
      ) : null}

      {analysis.diagnostics.length > 0 ? (
        <section className="insight-block">
          <div className="insight-block-header">
            <strong>Diagnostics</strong>
          </div>
          <div className="diagnostic-list">
            {analysis.diagnostics.slice(0, 12).map((diagnostic) => (
              <div className={`diagnostic-item ${diagnostic.severity}`} key={`${diagnostic.stream}-${diagnostic.line}-${diagnostic.text}`}>
                <code>
                  {diagnostic.stream}:{diagnostic.line}
                </code>
                <pre>{diagnostic.text}</pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analysis.artifacts.length > 0 ? (
        <section className="insight-block">
          <div className="insight-block-header">
            <strong>Artifacts</strong>
          </div>
          <div className="artifact-list">
            {analysis.artifacts.map((artifact) => (
              <ArtifactRow artifact={artifact} key={`${artifact.path}-${artifact.line}`} />
            ))}
          </div>
        </section>
      ) : null}

      {analysis.progress.length > 0 ? (
        <section className="insight-block">
          <div className="insight-block-header">
            <strong>Progress</strong>
          </div>
          <div className="progress-list">
            {analysis.progress.map((progress) => (
              <div className="progress-item" key={`${progress.stream}-${progress.line}-${progress.text}`}>
                {progress.percent !== undefined ? <span style={{ width: `${progress.percent}%` }} /> : null}
                <pre>{progress.text}</pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!combinedOutput ? (
        <div className="empty-insights">
          <Terminal size={22} />
          <span>No command output captured.</span>
        </div>
      ) : null}
    </div>
  );
}

function InsightStat({ label, value, tone }: { label: string; value: string; tone?: "error" | "warning" }) {
  return (
    <div className={`insight-stat ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ArtifactRow({ artifact }: { artifact: OutputArtifact }) {
  return (
    <div className="artifact-item">
      <span className={`artifact-kind ${artifact.kind}`}>{artifact.kind}</span>
      <code>{artifact.path}</code>
      <button className="mini-button dark" onClick={() => void copyText(artifact.path)}>
        Copy
      </button>
      <button className="mini-button dark" onClick={() => openArtifact(artifact)} disabled={!artifact.isAbsolute}>
        Open
      </button>
    </div>
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
  const cwd = run.cwd ? createConsoleLines("system", `Working directory: ${run.cwd}`, run.completedAt) : [];
  const env = run.envKeys?.length ? createConsoleLines("system", `Environment keys: ${run.envKeys.join(", ")}`, run.completedAt) : [];
  const stdout = createConsoleLines(run.executionMode === "pty" ? "terminal" : "stdout", run.stdout, run.completedAt);
  const stderr = createConsoleLines("stderr", run.stderr, run.completedAt);

  if (stdout.length === 0 && stderr.length === 0) {
    return [...summary, ...cwd, ...env, ...createConsoleLines("system", "No output captured for this run.", run.completedAt)];
  }

  return [...summary, ...cwd, ...env, ...stdout, ...stderr];
}

function diagnosticClassFor(text: string): string | undefined {
  if (/\b(error|fatal|exception|traceback|failed|failure|denied)\b/i.test(text)) return "highlight-error";
  if (/\b(warn|warning|deprecated|caution)\b/i.test(text)) return "highlight-warning";
  return undefined;
}

async function copyText(text: string): Promise<void> {
  if (!text) return;
  await navigator.clipboard?.writeText(text);
}

function downloadText(filename: string, text: string): void {
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function projectName(snapshot: ProjectSnapshot): string {
  return snapshot.projects.find((project) => project.id === snapshot.activeProjectId)?.name ?? "Project";
}

function sanitizeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "project"
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy failed.");
    }
  } finally {
    document.body.removeChild(textArea);
  }
}

function openArtifact(artifact: OutputArtifact): void {
  if (!artifact.isAbsolute) return;
  window.open(`file://${encodeURI(artifact.path)}`, "_blank", "noopener,noreferrer");
}

function tableToText(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.join("\t")).join("\n");
}
