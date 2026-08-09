import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  Bell,
  Box,
  CheckCircle2,
  Clock3,
  Database,
  FolderKanban,
  KeyRound,
  LogOut,
  LockKeyhole,
  ServerCog,
  Settings,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  UserRound,
  Workflow
} from "lucide-react";

type PublicSettings = {
  defaultMaxExecutionHours: number;
  defaultMaxWorkerTurns: number;
  defaultRetryLimit: number;
  loginFailuresBeforeBan: number;
  minFreeMemoryMb: number;
  minAvailableMemoryPercent: number;
  minFreeDiskMb: number;
  maxCpuUsagePercent: number | null;
  maxLoadAverage: number | null;
  memoryRecheckIntervalSeconds: number;
  resourceRecheckIntervalSeconds: number;
  staleHeartbeatSeconds: number;
  workerPollIntervalSeconds: number;
  codexTurnTimeoutSeconds: number;
  buildTimeoutSeconds: number;
  testTimeoutSeconds: number;
  mcpToolTimeoutSeconds: number;
  exportTimeoutSeconds: number;
  emulatorTimeoutSeconds: number;
  emailNotificationsEnabled: boolean;
  smtpConfigured: boolean;
};

type SessionResponse = {
  user?: {
    adminId: string;
    sessionId: string;
    expiresAt: string;
  };
};

type Fail2banResponse = {
  attempts: Array<{
    adminId: string | null;
    ipAddress: string;
    success: boolean;
    failureReason: string | null;
    createdAt: string;
  }>;
  bannedIps: Array<{
    ipAddress: string;
    reason: string;
    source: string;
    bannedAt: string;
    expiresAt: string | null;
  }>;
};

type CodexCompatibilityResponse = {
  status: "pass" | "fail" | "not_run";
  codexCliVersion: string | null;
  codexAuthUsable: boolean;
  jsonModeSupported: boolean;
  outputSchemaSupported: boolean;
  outputLastMessageSupported: boolean;
  execResumeSupported: boolean;
  hooksSupported: boolean;
  appServerTypeScriptSchemasGenerated: boolean;
  appServerJsonSchemasGenerated: boolean;
  configValidationPassed: boolean;
  stopHookCallbackVerified: boolean;
  jsonlParserRecognizesCurrentEvents: boolean;
  codexDocsIndexed: boolean;
  codexDocIndexId: string | null;
  codexDocIndexStatus: "not_started" | "indexing" | "ready" | "failed";
  buildEnvironmentReady: boolean;
  gapSummary: string;
  artifactPath: string | null;
  generatedSchemaPaths: {
    typeScript: string | null;
    jsonSchema: string | null;
  };
  smokeArtifacts: {
    jsonl: string | null;
    stderr: string | null;
    lastMessage: string | null;
  };
  ownership: {
    codexHomeDir: string;
    configPath: string;
    hooksPath: string;
    configOwner: "app" | "user" | "missing";
    hooksOwner: "app" | "user" | "missing";
    conflicts: string[];
  };
  createdAt: string | null;
};

type CodexHookStatusResponse = {
  codexHomeDir: string;
  configPath: string;
  hooksPath: string;
  configOwner: "app" | "user" | "missing";
  hooksOwner: "app" | "user" | "missing";
  conflicts: string[];
  appVersion: string;
  codexCliVersion: string | null;
  workerPollIntervalSeconds: number;
  lastStopHookAt: string | null;
  managedHooks: string[];
};

type CodexDocsIndexResponse = {
  status: "not_started" | "indexing" | "ready" | "failed";
  indexName: string;
  storePath: string;
  documentCount: number;
  uniqueUrlCount: number;
  codexCliVersion: string | null;
  indexedUrlList: string[];
  searchSmokeTest: {
    query: string;
    status: "pass" | "fail" | "not_run";
    resultCount: number;
    outputPreview: string;
  };
  artifactPath: string | null;
  gapReport: string;
  indexedAt: string | null;
};

type ToolchainResponse = {
  status: "not_started" | "running" | "succeeded" | "failed";
  installRoot: string;
  androidHome: string;
  gradleHome: string;
  avdHome: string;
  steps: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "pass" | "fail" | "skipped";
    output: string;
  }>;
  resolvedVersions: Record<string, string | null>;
  verification: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "pass" | "fail" | "skipped";
    output: string;
  }>;
  latestSnapshot: {
    id: string;
    snapshotName: string;
    androidPlatformVersion: string;
    androidBuildToolsVersion: string;
    gradleVersion: string;
    jdkVersion: string;
    emulatorImage: string | null;
    createdAt: string;
  } | null;
  artifactPath: string | null;
  errorSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type CapabilityResponse = {
  status: "not_started" | "running" | "succeeded" | "failed";
  capabilitiesRoot: string;
  codexConfigPath: string;
  requiredCount: number;
  installedCount: number;
  missingRequiredCount: number;
  conflictSummary: string | null;
  appManagedConfigPresent: boolean;
  capabilities: Array<{
    type: "mcp" | "skill" | "agent";
    id: string;
    sourceType: "bundled" | "repository" | "user";
    source: string | null;
    required: boolean;
    wiredTo: string[];
    installStage: "wizard" | "image" | "user";
    description: string;
    status: "configured" | "missing" | "optional_disabled" | "conflict";
    version: string | null;
    revision: string | null;
    lastVerifiedAt: string | null;
  }>;
  steps: Array<{
    id: string;
    label: string;
    status: "pending" | "pass" | "fail" | "skipped";
    output: string;
  }>;
  artifactPath: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type SetupStatus = {
  adminConfigured: boolean;
  setupComplete: boolean;
  steps: {
    admin: "pending" | "pass" | "fail";
    environment: "pending" | "pass" | "fail";
    ssh: "pending" | "pass" | "fail";
  };
  platform: {
    os: string | null;
    arch: string | null;
  };
  installPaths: Record<string, string>;
  commandChecks: Array<{
    id: string;
    command: string;
    required: boolean;
    status: "pass" | "fail";
    output: string;
  }>;
  sshPublicKey: string | null;
  sshPublicKeyPath: string | null;
  lastError: string | null;
};

type ProjectSummary = {
  id: string;
  projectName: string;
  appName: string;
  packageName: string;
  projectType: "new" | "existing";
  repositoryUrl: string;
  projectDir: string;
  status:
    | "running"
    | "production_ready_user_action_required"
    | "blocked_needs_user"
    | "failed"
    | "budget_exhausted"
    | "cancelled";
  currentPhase: string;
  maxExecutionHours: number;
  maxWorkerTurns: number;
  remoteReachable: boolean;
  currentVersion: string | null;
  lastCommitSha: string | null;
  lastPushedCommitSha: string | null;
  latestWorkerResponse: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProjectsResponse = {
  projects: ProjectSummary[];
};

type ArtifactSummary = {
  id: string;
  projectId: string | null;
  runId: string | null;
  artifactType: string;
  path: string;
  sha256: string | null;
  sizeBytes: number | null;
  redacted: boolean;
  retentionClass: string;
  compressedAt: string | null;
  verifiedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type ArtifactsResponse = {
  artifacts: ArtifactSummary[];
};

type ProjectExportSummary = {
  id: string;
  projectId: string;
  status: "queued" | "running" | "ready" | "failed" | "expired" | "deleted";
  exportType: "full_project_archive";
  includeIgnoredFiles: boolean;
  includeKeystores: boolean;
  artifactId: string | null;
  fileCount: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  errorSummary: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
};

type ProjectExportsResponse = {
  exports: ProjectExportSummary[];
};

type JobSummary = {
  id: string;
  projectId: string;
  jobType:
    | "supervisor_turn"
    | "worker_turn"
    | "verification"
    | "setup"
    | "notification"
    | "project_export";
  status:
    | "queued"
    | "waiting_resources"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "stale";
  resourceWaitReason: string | null;
  heartbeatAt: string | null;
  timeoutAt: string | null;
  staleAfter: string | null;
  scheduledAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
};

type JobsStatusResponse = {
  resourceSnapshot: {
    status: "pass" | "wait";
    waitReason: string | null;
    memory: {
      totalMb: number;
      freeMb: number;
      availableMb: number;
      availablePercent: number;
      requiredFreeMb: number;
      requiredAvailablePercent: number;
    };
    disk: {
      freeMb: number;
      requiredFreeMb: number;
    };
    cpu: {
      usagePercent: number | null;
      maxUsagePercent: number | null;
    };
    load: {
      oneMinute: number;
      maxLoadAverage: number | null;
    };
    nextCheckAt: string | null;
  };
  jobs: JobSummary[];
};

type SettingsTab =
  | "user"
  | "email"
  | "build"
  | "credentials"
  | "defaults"
  | "resources"
  | "security"
  | "fail2ban";

type KeyValueRows = Array<[string, string]>;

const settingsTabs: Array<{
  id: SettingsTab;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: "user", label: "User And Password", icon: UserRound },
  { id: "email", label: "Email Notifications", icon: Bell },
  { id: "build", label: "Build Environment", icon: ServerCog },
  { id: "credentials", label: "Credentials And Secrets", icon: KeyRound },
  { id: "defaults", label: "Default Project Limits", icon: SlidersHorizontal },
  { id: "resources", label: "Resource Limits", icon: Activity },
  { id: "security", label: "Security And Safety", icon: Shield },
  { id: "fail2ban", label: "Fail2ban Records", icon: ShieldAlert }
];

const secretRows: KeyValueRows = [
  ["Git SSH public key", "Not generated"],
  ["Uploaded secret files", "None"],
  ["API keys", "Not configured"],
  ["Play Console credentials", "Not configured"],
  ["AdMob identifiers", "Not configured"],
  ["Keystore references", "Project-specific"]
];

const securityRows: KeyValueRows = [
  ["Trusted proxy", "Disabled"],
  ["External exposure warning", "Review before public access"],
  ["Hook trust", "Bypassed for managed yolo runs"],
  ["Yolo/process isolation", "Same-container safeguards required"],
  ["Secret redaction", "Prompt/log/email policy enabled"],
  ["Worker model", "Same container child process"],
  ["Host fail2ban integration", "Template provided"]
];

const timelineRows = [
  "Create or import an Android/Kotlin project.",
  "Supervisor will draft the first worker prompt.",
  "Worker final responses and supervisor prompts will appear here."
];

export function App() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("user");
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [fail2ban, setFail2ban] = useState<Fail2banResponse | null>(null);
  const [codexCompatibility, setCodexCompatibility] = useState<CodexCompatibilityResponse | null>(
    null
  );
  const [codexHooks, setCodexHooks] = useState<CodexHookStatusResponse | null>(null);
  const [codexDocs, setCodexDocs] = useState<CodexDocsIndexResponse | null>(null);
  const [toolchain, setToolchain] = useState<ToolchainResponse | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [projectExports, setProjectExports] = useState<ProjectExportSummary[]>([]);
  const [jobsStatus, setJobsStatus] = useState<JobsStatusResponse | null>(null);
  const [projectWizardOpen, setProjectWizardOpen] = useState(false);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [codexReviewBusy, setCodexReviewBusy] = useState(false);
  const [codexDocsBusy, setCodexDocsBusy] = useState(false);
  const [toolchainBusy, setToolchainBusy] = useState(false);
  const [capabilityBusy, setCapabilityBusy] = useState(false);
  const [exportBusyProjectId, setExportBusyProjectId] = useState<string | null>(null);
  const [apiState, setApiState] = useState<"loading" | "ready" | "auth" | "setup" | "error">(
    "loading"
  );

  useEffect(() => {
    void loadApiState();
  }, []);

  async function loadApiState() {
    try {
      const setupResponse = await fetch("/api/setup/status", {
        credentials: "include"
      });
      const setupStatus = (await setupResponse.json()) as SetupStatus;
      setSetup(setupStatus);
      if (!setupStatus.adminConfigured) {
        setApiState("setup");
        return;
      }

      const sessionResponse = await fetch("/api/auth/session", {
        credentials: "include"
      });
      if (sessionResponse.status === 401) {
        setApiState("auth");
        return;
      }
      setSession((await sessionResponse.json()) as SessionResponse);

      const [
        settingsResponse,
        fail2banResponse,
        codexResponse,
        codexHooksResponse,
        codexDocsResponse,
        toolchainResponse,
        capabilityResponse,
        projectsResponse,
        artifactsResponse,
        exportsResponse,
        jobsResponse
      ] = await Promise.all([
        fetch("/api/settings", { credentials: "include" }),
        fetch("/api/security/fail2ban", { credentials: "include" }),
        fetch("/api/codex/compatibility", { credentials: "include" }),
        fetch("/api/codex/hooks/status", { credentials: "include" }),
        fetch("/api/codex/docs", { credentials: "include" }),
        fetch("/api/toolchain/status", { credentials: "include" }),
        fetch("/api/capabilities/status", { credentials: "include" }),
        fetch("/api/projects", { credentials: "include" }),
        fetch("/api/artifacts?limit=12", { credentials: "include" }),
        fetch("/api/project-exports?limit=8", { credentials: "include" }),
        fetch("/api/jobs/status", { credentials: "include" })
      ]);
      if (
        !settingsResponse.ok ||
        !fail2banResponse.ok ||
        !codexResponse.ok ||
        !codexHooksResponse.ok ||
        !codexDocsResponse.ok ||
        !toolchainResponse.ok ||
        !capabilityResponse.ok ||
        !projectsResponse.ok ||
        !artifactsResponse.ok ||
        !exportsResponse.ok ||
        !jobsResponse.ok
      ) {
        setApiState("error");
        return;
      }
      setSettings((await settingsResponse.json()) as PublicSettings);
      setFail2ban((await fail2banResponse.json()) as Fail2banResponse);
      setCodexCompatibility((await codexResponse.json()) as CodexCompatibilityResponse);
      setCodexHooks((await codexHooksResponse.json()) as CodexHookStatusResponse);
      setCodexDocs((await codexDocsResponse.json()) as CodexDocsIndexResponse);
      setToolchain((await toolchainResponse.json()) as ToolchainResponse);
      setCapabilities((await capabilityResponse.json()) as CapabilityResponse);
      setProjects(((await projectsResponse.json()) as ProjectsResponse).projects);
      setArtifacts(((await artifactsResponse.json()) as ArtifactsResponse).artifacts);
      setProjectExports(((await exportsResponse.json()) as ProjectExportsResponse).exports);
      setJobsStatus((await jobsResponse.json()) as JobsStatusResponse);
      setApiState("ready");
    } catch {
      setApiState("error");
    }
  }

  async function runCodexCompatibilityReview() {
    setCodexReviewBusy(true);
    try {
      const response = await fetch("/api/codex/compatibility/run", {
        method: "POST",
        credentials: "include"
      });
      if (response.ok) {
        setCodexCompatibility((await response.json()) as CodexCompatibilityResponse);
      } else {
        setApiState("error");
      }
    } finally {
      setCodexReviewBusy(false);
    }
  }

  async function runCodexDocsIndex() {
    setCodexDocsBusy(true);
    try {
      const response = await fetch("/api/codex/docs/index", {
        method: "POST",
        credentials: "include"
      });
      if (response.ok) {
        setCodexDocs((await response.json()) as CodexDocsIndexResponse);
      } else {
        setApiState("error");
      }
    } finally {
      setCodexDocsBusy(false);
    }
  }

  async function runToolchainInstall() {
    setToolchainBusy(true);
    try {
      const response = await fetch("/api/toolchain/install", {
        method: "POST",
        credentials: "include"
      });
      if (response.ok) {
        setToolchain((await response.json()) as ToolchainResponse);
      } else {
        setApiState("error");
      }
    } finally {
      setToolchainBusy(false);
    }
  }

  async function runCapabilityInstall() {
    setCapabilityBusy(true);
    try {
      const response = await fetch("/api/capabilities/install", {
        method: "POST",
        credentials: "include"
      });
      if (response.ok) {
        setCapabilities((await response.json()) as CapabilityResponse);
      } else {
        setApiState("error");
      }
    } finally {
      setCapabilityBusy(false);
    }
  }

  async function requestProjectExport(projectId: string) {
    setExportBusyProjectId(projectId);
    try {
      const response = await fetch(`/api/projects/${projectId}/exports`, {
        method: "POST",
        credentials: "include"
      });
      if (!response.ok) {
        setApiState("error");
        return;
      }
      await response.json();
      await loadApiState();
    } finally {
      setExportBusyProjectId(null);
    }
  }

  const readiness = useMemo<KeyValueRows>(
    () => [
      ["Authentication", apiState === "ready" ? "Signed in" : statusLabel(apiState)],
      ["Database", "PostgreSQL migrations enabled"],
      ["Fail2ban", "Auth failure log configured"],
      ["Exports", "ZIP enabled"],
      ["Resources", jobsStatus?.resourceSnapshot.status ?? "Unknown"],
      ["Job runner", `${jobsStatus?.jobs.length ?? 0} recent jobs`]
    ],
    [apiState, jobsStatus]
  );
  const buildEnvironmentRows = useMemo<KeyValueRows>(
    () => createBuildRows(codexCompatibility, codexDocs, toolchain, capabilities),
    [codexCompatibility, codexDocs, toolchain, capabilities]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Box size={20} />
          <div>
            <strong>App Factory</strong>
            <span>Supervisor</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <a className="nav-item active" href="#projects">
            <FolderKanban size={18} />
            Projects
          </a>
          <a className="nav-item" href="#build-environment">
            <ServerCog size={18} />
            Build Environment
          </a>
          <a className="nav-item" href="#settings">
            <Settings size={18} />
            Settings
          </a>
        </nav>

        <div className="sidebar-footer">
          <span>v0.1.0</span>
          <button type="button" className="logout-button" aria-label="Log out">
            <LogOut size={17} />
            Log out
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Projects</h1>
            <p>Android/Kotlin automation dashboard for Codex worker runs.</p>
          </div>
          <div className="status-strip">
            <span>
              <Activity size={16} />
              Runtime online
            </span>
            <span>
              <ShieldAlert size={16} />
              {statusLabel(apiState)}
            </span>
          </div>
        </header>

        {setup && !setup.setupComplete ? (
          <WizardPanel
            setup={setup}
            apiState={apiState}
            onReload={() => {
              void loadApiState();
            }}
          />
        ) : null}

        <section id="projects" className="panel-grid">
          <div className="panel wide">
            <div className="panel-heading">
              <h2>Project Queue</h2>
              <button
                type="button"
                disabled={apiState !== "ready"}
                onClick={() => setProjectWizardOpen((value) => !value)}
              >
                {projectWizardOpen ? "Close" : "New Project"}
              </button>
            </div>
            {projectWizardOpen ? (
              <ProjectWizard
                settings={settings}
                onCreated={() => {
                  setProjectWizardOpen(false);
                  void loadApiState();
                }}
              />
            ) : null}
            <div className="table">
              <div className="table-row table-head">
                <span>Project</span>
                <span>Phase</span>
                <span>Progress</span>
                <span>Version</span>
                <span>Status</span>
                <span>Actions</span>
              </div>
              {projects.length === 0 ? (
                <div className="table-row">
                  <span>No active project</span>
                  <span>Waiting for project wizard</span>
                  <span>
                    <span className="progress-track">
                      <span style={{ width: "0%" }} />
                    </span>
                  </span>
                  <span>None</span>
                  <span className="chip muted">Setup required</span>
                  <span />
                </div>
              ) : null}
              {projects.map((project) => (
                <div className="table-row" key={project.id}>
                  <span>{project.projectName}</span>
                  <span>{project.currentPhase}</span>
                  <span>
                    <span className="progress-track">
                      <span style={{ width: `${projectProgress(project)}%` }} />
                    </span>
                  </span>
                  <span title={versionTitle(project)}>{project.currentVersion ?? "No version"}</span>
                  <span className={project.status === "running" ? "chip" : "chip muted"}>
                    {project.status}
                  </span>
                  <span>
                    <button
                      type="button"
                      disabled={exportBusyProjectId === project.id}
                      onClick={() => void requestProjectExport(project.id)}
                    >
                      {exportBusyProjectId === project.id ? "Zipping" : "ZIP"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div id="build-environment" className="panel">
            <div className="panel-heading">
              <h2>Build Environment</h2>
              <div className="button-row">
                <button
                  type="button"
                  disabled={apiState !== "ready" || capabilityBusy}
                  onClick={() => void runCapabilityInstall()}
                >
                  {capabilityBusy ? "Wiring" : "Install Capabilities"}
                </button>
                <button
                  type="button"
                  disabled={apiState !== "ready" || toolchainBusy}
                  onClick={() => void runToolchainInstall()}
                >
                  {toolchainBusy ? "Installing" : "Install Tools"}
                </button>
                <button
                  type="button"
                  disabled={apiState !== "ready" || codexDocsBusy}
                  onClick={() => void runCodexDocsIndex()}
                >
                  {codexDocsBusy ? "Indexing" : "Index Docs"}
                </button>
                <button
                  type="button"
                  disabled={apiState !== "ready" || codexReviewBusy}
                  onClick={() => void runCodexCompatibilityReview()}
                >
                  {codexReviewBusy ? "Checking" : "Verify Codex"}
                </button>
              </div>
            </div>
            <KeyValueList rows={buildEnvironmentRows.slice(0, 6)} />
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Supervisor Loop</h2>
              <Workflow size={18} />
            </div>
            <ol className="timeline">
              {timelineRows.map((row) => (
                <li key={row}>
                  <Clock3 size={16} />
                  <span>{row}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="panel wide">
            <div className="panel-heading">
              <h2>System Readiness</h2>
              <CheckCircle2 size={18} />
            </div>
            <KeyValueList className="readiness-grid" rows={readiness} />
          </div>

          <div className="panel wide">
            <div className="panel-heading">
              <h2>Job Runner</h2>
              <Activity size={18} />
            </div>
            <JobRunnerPanel jobsStatus={jobsStatus} />
          </div>

          <div className="panel wide">
            <div className="panel-heading">
              <h2>Recent Artifacts</h2>
              <Database size={18} />
            </div>
            <ArtifactTable artifacts={artifacts} />
          </div>

          <div className="panel wide">
            <div className="panel-heading">
              <h2>Project Exports</h2>
              <Database size={18} />
            </div>
            <ProjectExportTable exports={projectExports} />
          </div>
        </section>

        <section id="settings" className="settings-section">
          <div className="section-heading">
            <h2>Settings</h2>
            <span className="chip muted">Single-user administration</span>
          </div>
          <div className="settings-layout">
            <div className="tab-list" role="tablist" aria-label="Settings sections">
              {settingsTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={activeTab === tab.id ? "tab-button active" : "tab-button"}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <Icon size={17} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="settings-panel" role="tabpanel">
              {renderSettingsTab(
                activeTab,
                settings,
                session,
                fail2ban,
                codexCompatibility,
                codexHooks,
                codexDocs,
                toolchain,
                capabilities,
                buildEnvironmentRows,
                apiState
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function WizardPanel({
  setup,
  apiState,
  onReload
}: {
  setup: SetupStatus;
  apiState: "loading" | "ready" | "auth" | "setup" | "error";
  onReload: () => void;
}) {
  const [busy, setBusy] = useState<"admin" | "environment" | "ssh" | null>(null);
  const canRunProtectedStep = apiState === "ready";

  async function postStep(path: string, step: "environment" | "ssh") {
    setBusy(step);
    await fetch(path, {
      method: "POST",
      credentials: "include"
    });
    setBusy(null);
    onReload();
  }

  return (
    <section className="wizard-panel">
      <div className="section-heading">
        <h2>First-Run Setup</h2>
        <span className="chip muted">Project execution locked until complete</span>
      </div>
      <div className="wizard-grid">
        <div className="wizard-step">
          <StepHeader number="1" title="Admin Account" status={setup.steps.admin} />
          {setup.adminConfigured ? (
            <p>Single admin account is configured.</p>
          ) : (
            <CreateAdminForm busy={busy === "admin"} setBusy={setBusy} onReload={onReload} />
          )}
        </div>

        <div className="wizard-step">
          <StepHeader number="2" title="Deployment Environment" status={setup.steps.environment} />
          <KeyValueList
            rows={[
              ["OS", setup.platform.os ?? "Not checked"],
              ["CPU architecture", setup.platform.arch ?? "Not checked"],
              ["Data path", setup.installPaths.data ?? "Not checked"],
              ["Projects path", setup.installPaths.projects ?? "Not checked"]
            ]}
          />
          <button
            type="button"
            disabled={!canRunProtectedStep || busy === "environment"}
            onClick={() => void postStep("/api/setup/environment/verify", "environment")}
          >
            {busy === "environment" ? "Checking" : "Verify Environment"}
          </button>
          <div className="command-checks">
            {setup.commandChecks.slice(0, 10).map((check) => (
              <span className={check.status === "pass" ? "check-pass" : "check-fail"} key={check.id}>
                {check.command}: {check.status}
              </span>
            ))}
          </div>
        </div>

        <div className="wizard-step">
          <StepHeader number="3" title="Git SSH Public Key" status={setup.steps.ssh} />
          <p>Register this public key with your Git host for repository access.</p>
          <button
            type="button"
            disabled={!canRunProtectedStep || busy === "ssh"}
            onClick={() => void postStep("/api/setup/ssh-key", "ssh")}
          >
            {busy === "ssh" ? "Generating" : "Generate Public Key"}
          </button>
          {setup.sshPublicKey ? (
            <pre className="public-key">{setup.sshPublicKey}</pre>
          ) : (
            <p className="muted-copy">The private key is stored in app data and is never shown.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function StepHeader({
  number,
  title,
  status
}: {
  number: string;
  title: string;
  status: "pending" | "pass" | "fail";
}) {
  return (
    <div className="step-header">
      <span>{number}</span>
      <strong>{title}</strong>
      <em>{status}</em>
    </div>
  );
}

function ProjectWizard({
  settings,
  onCreated
}: {
  settings: PublicSettings | null;
  onCreated: () => void;
}) {
  const [projectName, setProjectName] = useState("");
  const [appName, setAppName] = useState("");
  const [packageName, setPackageName] = useState("com.example.app");
  const [userAppPlan, setUserAppPlan] = useState("");
  const [projectType, setProjectType] = useState<"new" | "existing">("new");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [globalGitUserName, setGlobalGitUserName] = useState("");
  const [globalGitUserEmail, setGlobalGitUserEmail] = useState("");
  const [maxExecutionHours, setMaxExecutionHours] = useState(
    `${settings?.defaultMaxExecutionHours ?? 24}`
  );
  const [maxWorkerTurns, setMaxWorkerTurns] = useState(`${settings?.defaultMaxWorkerTurns ?? 200}`);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("New projects generate a release keystore. Existing projects upload it later.");

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    const response = await fetch("/api/projects", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        projectName,
        appName,
        packageName,
        userAppPlan,
        projectType,
        repositoryUrl,
        globalGitUserName,
        globalGitUserEmail,
        maxExecutionHours: Number(maxExecutionHours),
        maxWorkerTurns: Number(maxWorkerTurns)
      })
    });
    if (!response.ok) {
      setStatus("error");
      setMessage("Project creation failed. Check required fields and Git access.");
      return;
    }
    const created = (await response.json()) as ProjectSummary & {
      gitStatus: { remoteReachable: boolean };
      keystore: { created: boolean };
    };
    setStatus("saved");
    setMessage(
      created.gitStatus.remoteReachable
        ? "Project created and Git remote verified."
        : "Project created, but Git access needs user action before automation can run."
    );
    onCreated();
  }

  return (
    <form className="project-wizard" onSubmit={(event) => void submitProject(event)}>
      <div className="wizard-form-grid">
        <label>
          <span>Project name</span>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
        </label>
        <label>
          <span>App name</span>
          <input value={appName} onChange={(event) => setAppName(event.target.value)} />
        </label>
        <label>
          <span>Package name</span>
          <input value={packageName} onChange={(event) => setPackageName(event.target.value)} />
        </label>
        <label>
          <span>Project type</span>
          <select
            value={projectType}
            onChange={(event) => setProjectType(event.target.value as "new" | "existing")}
          >
            <option value="new">New project</option>
            <option value="existing">Existing project</option>
          </select>
        </label>
        <label className="wide-field">
          <span>{projectType === "new" ? "Empty repository URL" : "Existing repository URL"}</span>
          <input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} />
        </label>
        <label>
          <span>Git user.name</span>
          <input
            value={globalGitUserName}
            onChange={(event) => setGlobalGitUserName(event.target.value)}
          />
        </label>
        <label>
          <span>Git user.email</span>
          <input
            value={globalGitUserEmail}
            onChange={(event) => setGlobalGitUserEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Max execution hours</span>
          <input
            type="number"
            min="1"
            max="720"
            value={maxExecutionHours}
            onChange={(event) => setMaxExecutionHours(event.target.value)}
          />
        </label>
        <label>
          <span>Max worker turns</span>
          <input
            type="number"
            min="1"
            max="2000"
            value={maxWorkerTurns}
            onChange={(event) => setMaxWorkerTurns(event.target.value)}
          />
        </label>
        <label className="wide-field">
          <span>User app plan</span>
          <textarea
            value={userAppPlan}
            onChange={(event) => setUserAppPlan(event.target.value)}
            rows={5}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Creating" : "Create Project"}
        </button>
        <span>{message}</span>
      </div>
    </form>
  );
}

function CreateAdminForm({
  busy,
  setBusy,
  onReload
}: {
  busy: boolean;
  setBusy: (value: "admin" | "environment" | "ssh" | null) => void;
  onReload: () => void;
}) {
  const [adminId, setAdminId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submitAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("admin");
    setError(null);
    const response = await fetch("/api/setup/admin", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        adminId,
        password,
        passwordConfirmation
      })
    });
    setBusy(null);
    if (!response.ok) {
      setError("Admin setup failed.");
      return;
    }
    setAdminId("");
    setPassword("");
    setPasswordConfirmation("");
    onReload();
  }

  return (
    <form className="settings-form" onSubmit={(event) => void submitAdmin(event)}>
      <label>
        <span>Admin ID</span>
        <input value={adminId} onChange={(event) => setAdminId(event.target.value)} />
      </label>
      <label>
        <span>Password</span>
        <input
          autoComplete="new-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label>
        <span>Confirm password</span>
        <input
          autoComplete="new-password"
          type="password"
          value={passwordConfirmation}
          onChange={(event) => setPasswordConfirmation(event.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Creating" : "Create Admin"}
        </button>
        <span>{error ?? "Password must be at least 12 characters."}</span>
      </div>
    </form>
  );
}

function projectProgress(project: ProjectSummary): number {
  if (project.status === "production_ready_user_action_required") {
    return 100;
  }
  if (project.status === "blocked_needs_user") {
    return 5;
  }
  const phaseWeights: Record<string, number> = {
    "product definition": 5,
    "market review": 12,
    "roadmap planning": 20,
    "UX planning": 28,
    implementation: 55,
    "gap review": 68,
    "QA planning": 75,
    "emulator verification": 86,
    "code review": 93,
    "production ready": 100
  };
  return phaseWeights[project.currentPhase] ?? 0;
}

function versionTitle(project: ProjectSummary): string {
  return [
    `version: ${project.currentVersion ?? "none"}`,
    `last commit: ${project.lastCommitSha ?? "none"}`,
    `last pushed: ${project.lastPushedCommitSha ?? "none"}`
  ].join("\n");
}

function renderSettingsTab(
  tab: SettingsTab,
  settings: PublicSettings | null,
  session: SessionResponse | null,
  fail2ban: Fail2banResponse | null,
  codexCompatibility: CodexCompatibilityResponse | null,
  codexHooks: CodexHookStatusResponse | null,
  codexDocs: CodexDocsIndexResponse | null,
  toolchain: ToolchainResponse | null,
  capabilities: CapabilityResponse | null,
  buildEnvironmentRows: KeyValueRows,
  apiState: "loading" | "ready" | "auth" | "setup" | "error"
) {
  if (apiState !== "ready") {
    return <EmptyState title={statusLabel(apiState)} detail={stateDetail(apiState)} />;
  }

  switch (tab) {
    case "user":
      return (
        <div className="settings-stack">
          <SettingsGroup
            title="User And Password"
            rows={[
              ["Admin ID", session?.user?.adminId ?? "Unknown"],
              ["Session ID", session?.user?.sessionId ?? "Unavailable"],
              ["Session expiration", session?.user?.expiresAt ?? "Unavailable"]
            ]}
          />
          <PasswordChangeForm />
        </div>
      );
    case "email":
      return (
        <SettingsGroup
          title="Email Notifications"
          rows={[
            ["SMTP/provider", settings?.smtpConfigured ? "Configured" : "Not configured"],
            ["Recipient", "Not configured"],
            ["Test email", "Pending Phase 30"],
            ["Terminal status toggle", settings?.emailNotificationsEnabled ? "Enabled" : "Disabled"]
          ]}
        />
      );
    case "build":
      return (
        <div className="settings-stack">
          <SettingsGroup title="Build Environment" rows={buildEnvironmentRows} />
          <SettingsGroup
            title="Android Toolchain"
            rows={[
              ["Install status", toolchain?.status ?? "not_started"],
              ["Install root", toolchain?.installRoot ?? "Unavailable"],
              ["Android home", toolchain?.androidHome ?? "Unavailable"],
              ["Gradle home", toolchain?.gradleHome ?? "Unavailable"],
              ["AVD home", toolchain?.avdHome ?? "Unavailable"],
              ["Latest snapshot", toolchain?.latestSnapshot?.snapshotName ?? "None"],
              ["Android platform", toolchain?.latestSnapshot?.androidPlatformVersion ?? "Unknown"],
              ["Build tools", toolchain?.latestSnapshot?.androidBuildToolsVersion ?? "Unknown"],
              ["Gradle", toolchain?.latestSnapshot?.gradleVersion ?? "Unknown"],
              ["JDK", toolchain?.latestSnapshot?.jdkVersion ?? "Unknown"],
              ["AVD/emulator", toolchain?.latestSnapshot?.emulatorImage ?? "Not verified"],
              ["Install report", toolchain?.artifactPath ?? "Unavailable"],
              ["Error summary", toolchain?.errorSummary ?? "None"]
            ]}
          />
          <SettingsGroup
            title="Capability Installer"
            rows={[
              ["Install status", capabilities?.status ?? "not_started"],
              ["Capabilities root", capabilities?.capabilitiesRoot ?? "Unavailable"],
              ["Codex config", capabilities?.codexConfigPath ?? "Unavailable"],
              ["App-managed config", boolLabel(capabilities?.appManagedConfigPresent)],
              ["Required capabilities", `${capabilities?.requiredCount ?? 0}`],
              ["Configured capabilities", `${capabilities?.installedCount ?? 0}`],
              ["Missing required", `${capabilities?.missingRequiredCount ?? 0}`],
              ["Required MCPs", capabilityCountLabel(capabilities, "mcp", true)],
              ["Bundled worker skills", capabilityCountLabel(capabilities, "skill", true)],
              ["Bundled review agents", capabilityCountLabel(capabilities, "agent", true)],
              ["Conflict summary", capabilities?.conflictSummary ?? "None"],
              ["Install report", capabilities?.artifactPath ?? "Unavailable"]
            ]}
          />
          <CapabilityInventory capabilities={capabilities} />
          <SettingsGroup
            title="Codex Compatibility Review"
            rows={[
              ["Review status", codexCompatibility?.status ?? "not_run"],
              ["Build environment ready", boolLabel(codexCompatibility?.buildEnvironmentReady)],
              ["Codex CLI version", codexCompatibility?.codexCliVersion ?? "Unknown"],
              ["JSON mode", boolLabel(codexCompatibility?.jsonModeSupported)],
              ["Output schema", boolLabel(codexCompatibility?.outputSchemaSupported)],
              ["Output last message", boolLabel(codexCompatibility?.outputLastMessageSupported)],
              ["Exec resume", boolLabel(codexCompatibility?.execResumeSupported)],
              ["Official docs indexed", boolLabel(codexCompatibility?.codexDocsIndexed)],
              ["Docs index status", codexCompatibility?.codexDocIndexStatus ?? "not_started"],
              ["Config validation", boolLabel(codexCompatibility?.configValidationPassed)],
              ["Stop hook callback", boolLabel(codexCompatibility?.stopHookCallbackVerified)],
              ["Schema artifact", codexCompatibility?.generatedSchemaPaths.jsonSchema ?? "Unavailable"],
              ["Review artifact", codexCompatibility?.artifactPath ?? "Unavailable"],
              ["Gap summary", codexCompatibility?.gapSummary ?? "Review has not run."]
            ]}
          />
          <SettingsGroup
            title="Managed Codex Hooks"
            rows={[
              ["Hooks owner", codexHooks?.hooksOwner ?? "missing"],
              ["Config owner", codexHooks?.configOwner ?? "missing"],
              ["Managed hooks", codexHooks?.managedHooks.join(", ") ?? "Unavailable"],
              ["Worker poll fallback", `${codexHooks?.workerPollIntervalSeconds ?? "-"} seconds`],
              ["Last Stop hook", codexHooks?.lastStopHookAt ?? "Never"],
              [
                "Ownership conflicts",
                codexHooks?.conflicts.length ? codexHooks.conflicts.join("; ") : "None"
              ],
              ["Hooks path", codexHooks?.hooksPath ?? "Unavailable"]
            ]}
          />
          <SettingsGroup
            title="Codex Documentation Index"
            rows={[
              ["Index status", codexDocs?.status ?? "not_started"],
              ["Index name", codexDocs?.indexName ?? "openai-codex"],
              ["Document count", `${codexDocs?.documentCount ?? 0}`],
              ["Unique URLs", `${codexDocs?.uniqueUrlCount ?? 0}`],
              ["Search smoke", codexDocs?.searchSmokeTest.status ?? "not_run"],
              ["Search result count", `${codexDocs?.searchSmokeTest.resultCount ?? 0}`],
              ["Store path", codexDocs?.storePath ?? "Unavailable"],
              ["Index artifact", codexDocs?.artifactPath ?? "Unavailable"],
              ["Indexed at", codexDocs?.indexedAt ?? "Never"],
              ["Gap report", codexDocs?.gapReport ?? "Codex official documentation has not been indexed."]
            ]}
          />
        </div>
      );
    case "credentials":
      return <SettingsGroup title="Credentials And Secrets" rows={secretRows} />;
    case "defaults":
      return (
        <SettingsGroup
          title="Default Project Limits"
          rows={[
            ["Max execution hours", `${settings?.defaultMaxExecutionHours ?? "-"} hours`],
            ["Max worker turns", `${settings?.defaultMaxWorkerTurns ?? "-"} turns`],
            ["Retry limits", `${settings?.defaultRetryLimit ?? "-"} attempts`],
            ["Default memory threshold", `${settings?.minFreeMemoryMb ?? "-"} MB`]
          ]}
        />
      );
    case "resources":
      return (
        <SettingsGroup
          title="Resource Limits"
          rows={[
            ["CPU limit", settings?.maxCpuUsagePercent ? `${settings.maxCpuUsagePercent}%` : "Unset"],
            ["Current memory status", "Pending resource monitor"],
            [
              "Free/available memory",
              `${settings?.minFreeMemoryMb ?? "-"} MB / ${settings?.minAvailableMemoryPercent ?? "-"}%`
            ],
            ["Free disk threshold", `${settings?.minFreeDiskMb ?? "-"} MB`],
            ["Recheck interval", `${settings?.resourceRecheckIntervalSeconds ?? "-"} seconds`],
            ["Worker timeout", `${settings?.codexTurnTimeoutSeconds ?? "-"} seconds`],
            ["Stale heartbeat", `${settings?.staleHeartbeatSeconds ?? "-"} seconds`],
            ["Artifact retention", "Pending artifact phase"],
            ["Export retention", "Pending export phase"]
          ]}
        />
      );
    case "security":
      return <SettingsGroup title="Security And Safety" rows={securityRows} />;
    case "fail2ban":
      return (
        <div className="settings-stack">
          <SettingsGroup
            title="Fail2ban Summary"
            rows={[
              ["Failed/success logins", `${fail2ban?.attempts.length ?? 0} recent records`],
              ["Banned IPs", `${fail2ban?.bannedIps.length ?? 0} active or recent records`]
            ]}
          />
          <div className="mini-table">
            <div className="mini-row mini-head">
              <span>IP</span>
              <span>Result</span>
              <span>Reason</span>
              <span>Timestamp</span>
            </div>
            {(fail2ban?.attempts ?? []).slice(0, 8).map((attempt) => (
              <div className="mini-row" key={`${attempt.ipAddress}-${attempt.createdAt}`}>
                <span>{attempt.ipAddress}</span>
                <span>{attempt.success ? "success" : "failed"}</span>
                <span>{attempt.failureReason ?? "none"}</span>
                <span>{attempt.createdAt}</span>
              </div>
            ))}
          </div>
        </div>
      );
  }
}

function createBuildRows(
  codexCompatibility: CodexCompatibilityResponse | null,
  codexDocs: CodexDocsIndexResponse | null,
  toolchain: ToolchainResponse | null,
  capabilities: CapabilityResponse | null
): KeyValueRows {
  return [
    ["Android SDK", toolchain?.latestSnapshot ? toolchain.latestSnapshot.androidPlatformVersion : "Not installed"],
    ["Gradle", toolchain?.latestSnapshot?.gradleVersion ?? "Not installed"],
    ["JDK", toolchain?.latestSnapshot?.jdkVersion ?? "Not installed"],
    ["Toolchain snapshots", toolchain?.latestSnapshot ? toolchain.latestSnapshot.snapshotName : "None"],
    ["AVD/emulator", toolchain?.latestSnapshot?.emulatorImage ?? "Not verified"],
    ["Toolchain install", toolchain?.status ?? "not_started"],
    ["MCP status", capabilityTypeLabel(capabilities, "mcp")],
    ["Skill/agent wiring", `${capabilityTypeLabel(capabilities, "skill")} / ${capabilityTypeLabel(capabilities, "agent")}`],
    ["Codex CLI/auth/JSONL", codexRuntimeLabel(codexCompatibility)],
    ["Codex docs index", codexDocsLabel(codexDocs)],
    ["Compatibility review", codexCompatibility?.status ?? "Not run"],
    ["Managed config", codexCompatibility?.ownership.configOwner ?? "missing"],
    ["Managed hooks", codexCompatibility?.ownership.hooksOwner ?? "missing"],
    [
      "Ownership conflicts",
      codexCompatibility?.ownership.conflicts.length
        ? codexCompatibility.ownership.conflicts.join("; ")
        : "None"
    ]
  ];
}

function CapabilityInventory({ capabilities }: { capabilities: CapabilityResponse | null }) {
  const rows = (capabilities?.capabilities ?? []).slice(0, 18);
  return (
    <div className="settings-stack">
      <div className="panel-heading">
        <h3>Capability Inventory</h3>
        <Workflow size={17} />
      </div>
      <div className="mini-table">
        <div className="mini-row mini-head">
          <span>Capability</span>
          <span>Type</span>
          <span>Stage</span>
          <span>Status</span>
        </div>
        {rows.map((capability) => (
          <div className="mini-row" key={`${capability.type}:${capability.id}`}>
            <span>{capability.id}</span>
            <span>{capability.type}</span>
            <span>{capability.installStage}</span>
            <span>{capability.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtifactTable({ artifacts }: { artifacts: ArtifactSummary[] }) {
  if (artifacts.length === 0) {
    return <p className="muted-copy">No artifacts have been recorded yet.</p>;
  }
  return (
    <div className="artifact-table">
      <div className="artifact-row artifact-head">
        <span>Type</span>
        <span>Size</span>
        <span>Retention</span>
        <span>Hash</span>
        <span>Content</span>
      </div>
      {artifacts.map((artifact) => (
        <div className="artifact-row" key={artifact.id}>
          <span title={artifact.path}>{artifact.artifactType}</span>
          <span>{formatBytes(artifact.sizeBytes)}</span>
          <span>{artifact.retentionClass}</span>
          <span title={artifact.sha256 ?? "No hash"}>{artifact.sha256?.slice(0, 12) ?? "none"}</span>
          <a href={artifactDownloadHref(artifact)}>Download</a>
        </div>
      ))}
    </div>
  );
}

function ProjectExportTable({ exports }: { exports: ProjectExportSummary[] }) {
  if (exports.length === 0) {
    return <p className="muted-copy">No project ZIP exports have been requested.</p>;
  }
  return (
    <div className="export-table">
      <div className="export-row export-head">
        <span>Status</span>
        <span>Files</span>
        <span>Size</span>
        <span>Checksum</span>
        <span>Expires</span>
        <span>Download</span>
      </div>
      {exports.map((exportRecord) => (
        <div className="export-row" key={exportRecord.id}>
          <span>{exportRecord.status}</span>
          <span>{exportRecord.fileCount ?? "unknown"}</span>
          <span>{formatBytes(exportRecord.sizeBytes)}</span>
          <span title={exportRecord.sha256 ?? "No checksum"}>
            {exportRecord.sha256?.slice(0, 12) ?? "none"}
          </span>
          <span>{exportRecord.expiresAt ?? "none"}</span>
          {exportRecord.status === "ready" ? (
            <a href={`/api/project-exports/${exportRecord.id}/download`}>ZIP</a>
          ) : (
            <span>{exportRecord.errorSummary ?? "Unavailable"}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function JobRunnerPanel({ jobsStatus }: { jobsStatus: JobsStatusResponse | null }) {
  if (!jobsStatus) {
    return <p className="muted-copy">Job runner status is unavailable.</p>;
  }
  const snapshot = jobsStatus.resourceSnapshot;
  return (
    <div className="settings-stack">
      <KeyValueList
        rows={[
          ["Resource status", snapshot.status],
          ["Wait reason", snapshot.waitReason ?? "None"],
          [
            "Memory",
            `${snapshot.memory.availableMb} MB available (${snapshot.memory.availablePercent}%)`
          ],
          ["Disk", `${snapshot.disk.freeMb} MB free`],
          ["Load", `${Math.round(snapshot.load.oneMinute * 100) / 100}`],
          ["Next check", snapshot.nextCheckAt ?? "Not waiting"]
        ]}
      />
      <div className="job-table">
        <div className="job-row job-head">
          <span>Type</span>
          <span>Status</span>
          <span>Wait</span>
          <span>Heartbeat</span>
          <span>Timeout</span>
        </div>
        {jobsStatus.jobs.slice(0, 8).map((job) => (
          <div className="job-row" key={job.id}>
            <span>{job.jobType}</span>
            <span>{job.status}</span>
            <span>{job.resourceWaitReason ?? job.errorSummary ?? "none"}</span>
            <span>{job.heartbeatAt ?? "none"}</span>
            <span>{job.timeoutAt ?? "none"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function artifactDownloadHref(artifact: ArtifactSummary): string {
  const exportId = artifact.metadata.exportId;
  if (artifact.artifactType === "project_export" && typeof exportId === "string") {
    return `/api/project-exports/${exportId}/download`;
  }
  return `/api/artifacts/${artifact.id}/content`;
}

function formatBytes(value: number | null): string {
  if (value === null) {
    return "unknown";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function capabilityTypeLabel(
  capabilities: CapabilityResponse | null,
  type: "mcp" | "skill" | "agent"
): string {
  if (!capabilities) {
    return "Not wired";
  }
  const typed = capabilities.capabilities.filter((capability) => capability.type === type);
  const configured = typed.filter((capability) => capability.status === "configured").length;
  const requiredMissing = typed.filter(
    (capability) => capability.required && capability.status !== "configured"
  ).length;
  return requiredMissing > 0 ? `${configured}/${typed.length} configured` : `${configured}/${typed.length} ready`;
}

function capabilityCountLabel(
  capabilities: CapabilityResponse | null,
  type: "mcp" | "skill" | "agent",
  required: boolean
): string {
  if (!capabilities) {
    return "0";
  }
  const matches = capabilities.capabilities.filter(
    (capability) => capability.type === type && capability.required === required
  );
  const configured = matches.filter((capability) => capability.status === "configured").length;
  return `${configured}/${matches.length}`;
}

function codexDocsLabel(codexDocs: CodexDocsIndexResponse | null): string {
  if (!codexDocs || codexDocs.status === "not_started") {
    return "Not indexed";
  }
  if (codexDocs.status === "ready") {
    return `${codexDocs.uniqueUrlCount} URLs indexed`;
  }
  return codexDocs.status;
}

function codexRuntimeLabel(codexCompatibility: CodexCompatibilityResponse | null): string {
  if (!codexCompatibility || codexCompatibility.status === "not_run") {
    return "Not verified";
  }
  if (!codexCompatibility.codexAuthUsable) {
    return "Auth missing or expired";
  }
  return codexCompatibility.buildEnvironmentReady ? "Ready" : "Partial";
}

function boolLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return "Unknown";
  }
  return value ? "Pass" : "Fail";
}

function SettingsGroup({ title, rows }: { title: string; rows: KeyValueRows }) {
  return (
    <div className="settings-stack">
      <div className="panel-heading">
        <h3>{title}</h3>
        <Database size={17} />
      </div>
      <KeyValueList rows={rows} />
    </div>
  );
}

function KeyValueList({
  rows,
  className = "kv-list"
}: {
  rows: KeyValueRows;
  className?: string;
}) {
  return (
    <div className={className}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    const response = await fetch("/api/auth/password", {
      method: "PUT",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        currentPassword,
        newPassword,
        newPasswordConfirmation
      })
    });

    if (response.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setStatus("saved");
      return;
    }

    setStatus("error");
  }

  return (
    <form className="settings-form" onSubmit={(event) => void submitPasswordChange(event)}>
      <div className="panel-heading">
        <h3>Password Change</h3>
        <LockKeyhole size={17} />
      </div>
      <label>
        <span>Current password</span>
        <input
          autoComplete="current-password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        <span>New password</span>
        <input
          autoComplete="new-password"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      <label>
        <span>Confirm new password</span>
        <input
          autoComplete="new-password"
          type="password"
          value={newPasswordConfirmation}
          onChange={(event) => setNewPasswordConfirmation(event.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving" : "Change Password"}
        </button>
        <span>{passwordStatusText(status)}</span>
      </div>
    </form>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <LockKeyhole size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function passwordStatusText(status: "idle" | "saving" | "saved" | "error") {
  switch (status) {
    case "idle":
      return "Changing the password revokes existing sessions.";
    case "saving":
      return "Saving password change.";
    case "saved":
      return "Password changed. Sign in again.";
    case "error":
      return "Password change failed.";
  }
}

function statusLabel(state: "loading" | "ready" | "auth" | "setup" | "error") {
  switch (state) {
    case "loading":
      return "Loading";
    case "ready":
      return "Signed in";
    case "auth":
      return "Login required";
    case "setup":
      return "Setup required";
    case "error":
      return "API error";
  }
}

function stateDetail(state: "loading" | "ready" | "auth" | "setup" | "error") {
  switch (state) {
    case "loading":
      return "Loading settings state.";
    case "ready":
      return "Settings are available.";
    case "auth":
      return "Sign in as the single admin to view protected settings.";
    case "setup":
      return "Create the admin account before using settings.";
    case "error":
      return "The settings API did not return a usable response.";
  }
}
