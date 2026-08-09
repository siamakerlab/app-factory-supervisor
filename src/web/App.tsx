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

const projects = [
  {
    name: "No active project",
    phase: "Waiting for project wizard",
    progress: 0,
    status: "Setup required"
  }
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
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [codexReviewBusy, setCodexReviewBusy] = useState(false);
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

      const [settingsResponse, fail2banResponse, codexResponse] = await Promise.all([
        fetch("/api/settings", { credentials: "include" }),
        fetch("/api/security/fail2ban", { credentials: "include" }),
        fetch("/api/codex/compatibility", { credentials: "include" })
      ]);
      if (!settingsResponse.ok || !fail2banResponse.ok || !codexResponse.ok) {
        setApiState("error");
        return;
      }
      setSettings((await settingsResponse.json()) as PublicSettings);
      setFail2ban((await fail2banResponse.json()) as Fail2banResponse);
      setCodexCompatibility((await codexResponse.json()) as CodexCompatibilityResponse);
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

  const readiness = useMemo<KeyValueRows>(
    () => [
      ["Authentication", apiState === "ready" ? "Signed in" : statusLabel(apiState)],
      ["Database", "PostgreSQL migrations enabled"],
      ["Fail2ban", "Auth failure log configured"],
      ["Exports", "Planned"]
    ],
    [apiState]
  );
  const buildEnvironmentRows = useMemo<KeyValueRows>(
    () => createBuildRows(codexCompatibility),
    [codexCompatibility]
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
              <button type="button">New Project</button>
            </div>
            <div className="table">
              <div className="table-row table-head">
                <span>Project</span>
                <span>Phase</span>
                <span>Progress</span>
                <span>Status</span>
              </div>
              {projects.map((project) => (
                <div className="table-row" key={project.name}>
                  <span>{project.name}</span>
                  <span>{project.phase}</span>
                  <span>
                    <span className="progress-track">
                      <span style={{ width: `${project.progress}%` }} />
                    </span>
                  </span>
                  <span className="chip muted">{project.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div id="build-environment" className="panel">
            <div className="panel-heading">
              <h2>Build Environment</h2>
              <button
                type="button"
                disabled={apiState !== "ready" || codexReviewBusy}
                onClick={() => void runCodexCompatibilityReview()}
              >
                {codexReviewBusy ? "Checking" : "Verify Codex"}
              </button>
            </div>
            <KeyValueList rows={buildEnvironmentRows.slice(0, 4)} />
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

function renderSettingsTab(
  tab: SettingsTab,
  settings: PublicSettings | null,
  session: SessionResponse | null,
  fail2ban: Fail2banResponse | null,
  codexCompatibility: CodexCompatibilityResponse | null,
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
            title="Codex Compatibility Review"
            rows={[
              ["Review status", codexCompatibility?.status ?? "not_run"],
              ["Build environment ready", boolLabel(codexCompatibility?.buildEnvironmentReady)],
              ["Codex CLI version", codexCompatibility?.codexCliVersion ?? "Unknown"],
              ["JSON mode", boolLabel(codexCompatibility?.jsonModeSupported)],
              ["Output schema", boolLabel(codexCompatibility?.outputSchemaSupported)],
              ["Output last message", boolLabel(codexCompatibility?.outputLastMessageSupported)],
              ["Exec resume", boolLabel(codexCompatibility?.execResumeSupported)],
              ["Config validation", boolLabel(codexCompatibility?.configValidationPassed)],
              ["Stop hook callback", boolLabel(codexCompatibility?.stopHookCallbackVerified)],
              ["Schema artifact", codexCompatibility?.generatedSchemaPaths.jsonSchema ?? "Unavailable"],
              ["Review artifact", codexCompatibility?.artifactPath ?? "Unavailable"],
              ["Gap summary", codexCompatibility?.gapSummary ?? "Review has not run."]
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

function createBuildRows(codexCompatibility: CodexCompatibilityResponse | null): KeyValueRows {
  return [
    ["Android SDK", "Not installed"],
    ["Gradle", "Not installed"],
    ["JDK", "Not installed"],
    ["Toolchain snapshots", "None"],
    ["AVD/emulator", "Not verified"],
    ["MCP status", "Pending setup"],
    ["Skill/agent wiring", "Pending setup"],
    ["Codex CLI/auth/JSONL", codexRuntimeLabel(codexCompatibility)],
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
