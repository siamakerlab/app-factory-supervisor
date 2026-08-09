import {
  Activity,
  Box,
  CheckCircle2,
  Clock3,
  FolderKanban,
  LogOut,
  ServerCog,
  Settings,
  ShieldAlert,
  Workflow
} from "lucide-react";

const projects = [
  {
    name: "No active project",
    phase: "Waiting for project wizard",
    progress: 0,
    status: "Setup required"
  }
];

const environmentRows = [
  ["Codex", "Not verified"],
  ["Android SDK", "Not installed"],
  ["Gradle/JDK", "Not installed"],
  ["MCP/Skills/Agents", "Not wired"]
];

const timelineRows = [
  "Create or import an Android/Kotlin project.",
  "Supervisor will draft the first worker prompt.",
  "Worker final responses and supervisor prompts will appear here."
];

export function App() {
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
              Setup pending
            </span>
          </div>
        </header>

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
              <ServerCog size={18} />
            </div>
            <div className="kv-list">
              {environmentRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
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

          <div id="settings" className="panel wide">
            <div className="panel-heading">
              <h2>System Readiness</h2>
              <CheckCircle2 size={18} />
            </div>
            <div className="readiness-grid">
              <div>
                <span>Authentication</span>
                <strong>Single-admin API enabled</strong>
              </div>
              <div>
                <span>Database</span>
                <strong>PostgreSQL migrations enabled</strong>
              </div>
              <div>
                <span>Fail2ban</span>
                <strong>Auth failure log configured</strong>
              </div>
              <div>
                <span>Exports</span>
                <strong>Planned</strong>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
