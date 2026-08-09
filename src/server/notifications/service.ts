import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import nodemailer from "nodemailer";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import type { ProjectCompletionGate, ProjectDetail } from "../projects/service.js";
import { redactSecrets } from "../security/secretScanner.js";

type SettingsRow = {
  email_notifications_enabled: boolean;
  notification_recipient_email: string | null;
  smtp_secret_id: string | null;
};

type SecretRow = {
  storage_path: string;
};

type SmtpSecret = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  recipientEmail: string;
};

export class NotificationService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async sendTestEmail(): Promise<{ status: "sent" | "disabled" | "failed"; summary: string }> {
    const settings = await this.getSettings();
    if (!settings.email_notifications_enabled || !settings.smtp_secret_id) {
      return { status: "disabled", summary: "Email notifications are disabled or SMTP is not configured." };
    }
    const smtp = await this.getSmtpSecret(settings.smtp_secret_id);
    return this.sendAndRecord({
      projectId: null,
      notificationType: "test_email",
      recipient: settings.notification_recipient_email ?? smtp.recipientEmail,
      subject: "App Factory Supervisor test email",
      body: "SMTP notification test succeeded. No project archive or secret is attached.",
      smtp
    });
  }

  async sendTerminalProjectEmail(input: {
    project: ProjectDetail;
    completion: ProjectCompletionGate;
  }): Promise<{ status: "sent" | "disabled" | "skipped" | "failed"; summary: string }> {
    if (input.completion.status === "running") {
      return { status: "skipped", summary: "Project is not terminal." };
    }
    const existing = await this.database.pool.query<{ id: string }>(
      `
        select id
        from notifications
        where project_id = $1 and notification_type = 'terminal_status' and status = 'sent'
        limit 1
      `,
      [input.project.id]
    );
    if (existing.rows[0]) {
      return { status: "skipped", summary: "Terminal notification already sent." };
    }
    const settings = await this.getSettings();
    if (!settings.email_notifications_enabled || !settings.smtp_secret_id) {
      return { status: "disabled", summary: "Email notifications are disabled or SMTP is not configured." };
    }
    const smtp = await this.getSmtpSecret(settings.smtp_secret_id);
    const body = terminalBody(input.project, input.completion);
    return this.sendAndRecord({
      projectId: input.project.id,
      notificationType: "terminal_status",
      recipient: settings.notification_recipient_email ?? smtp.recipientEmail,
      subject: `App Factory project ${input.completion.status}: ${input.project.projectName}`,
      body,
      smtp
    });
  }

  private async sendAndRecord(input: {
    projectId: string | null;
    notificationType: string;
    recipient: string;
    subject: string;
    body: string;
    smtp: SmtpSecret;
  }): Promise<{ status: "sent" | "failed"; summary: string }> {
    const bodyArtifactId = randomUUID();
    const notificationId = randomUUID();
    const artifactsDir = join(this.config.APP_DATA_DIR, "artifacts", "notifications");
    const bodyPath = join(artifactsDir, `${notificationId}.txt`);
    const redactedBody = redactSecrets(input.body).redacted;
    await mkdir(artifactsDir, { recursive: true, mode: 0o700 });
    await writeFile(bodyPath, redactedBody, { encoding: "utf8", mode: 0o600 });
    await this.database.pool.query(
      `
        insert into artifacts (id, project_id, artifact_type, path, redacted, retention_class, metadata, created_at)
        values ($1, $2, 'notification_body', $3, true, 'notification', $4, now())
      `,
      [bodyArtifactId, input.projectId, bodyPath, JSON.stringify({ notificationType: input.notificationType })]
    );
    try {
      const transporter = nodemailer.createTransport({
        host: input.smtp.host,
        port: input.smtp.port,
        secure: input.smtp.secure,
        auth: {
          user: input.smtp.username,
          pass: input.smtp.password
        }
      });
      await transporter.sendMail({
        from: input.smtp.fromEmail,
        to: input.recipient,
        subject: input.subject,
        text: redactedBody
      });
      await this.insertNotification(notificationId, input, bodyArtifactId, "sent", null);
      return { status: "sent", summary: "Email sent." };
    } catch (error) {
      const summary = error instanceof Error ? error.message.slice(0, 1000) : "Unknown email failure.";
      await this.insertNotification(notificationId, input, bodyArtifactId, "failed", summary);
      return { status: "failed", summary };
    }
  }

  private async insertNotification(
    notificationId: string,
    input: { projectId: string | null; notificationType: string; recipient: string; subject: string },
    bodyArtifactId: string,
    status: "sent" | "failed",
    errorSummary: string | null
  ): Promise<void> {
    await this.database.pool.query(
      `
        insert into notifications (
          id, project_id, notification_type, recipient, status, subject,
          body_artifact_id, sent_at, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, case when $5 = 'sent' then now() else null end, now())
      `,
      [
        notificationId,
        input.projectId,
        input.notificationType,
        input.recipient,
        status,
        errorSummary ? `${input.subject} (${errorSummary})` : input.subject,
        bodyArtifactId
      ]
    );
  }

  private async getSettings(): Promise<SettingsRow> {
    const result = await this.database.pool.query<SettingsRow>(
      "select email_notifications_enabled, notification_recipient_email, smtp_secret_id from app_settings where id = true"
    );
    return result.rows[0] ?? {
      email_notifications_enabled: false,
      notification_recipient_email: null,
      smtp_secret_id: null
    };
  }

  private async getSmtpSecret(secretId: string): Promise<SmtpSecret> {
    const result = await this.database.pool.query<SecretRow>(
      "select storage_path from secrets where id = $1 and secret_type = 'smtp_credentials'",
      [secretId]
    );
    const path = result.rows[0]?.storage_path;
    if (!path) {
      throw new Error("smtp_secret_missing");
    }
    return JSON.parse(await readFile(path, "utf8")) as SmtpSecret;
  }
}

function terminalBody(project: ProjectDetail, completion: ProjectCompletionGate): string {
  return [
    `Final status: ${completion.status}`,
    `Project: ${project.projectName}`,
    `Project path: ${project.projectDir}`,
    "",
    "Completed work summary:",
    project.finalStatusSummary,
    "",
    "Verification summary:",
    `Overall: ${project.verification.overallStatus}`,
    `Latest tier: ${project.verification.latestTier ?? "none"}`,
    "",
    "Evidence:",
    ...completion.evidence.map((item) => `- ${item}`),
    "",
    "Remaining user actions:",
    ...(completion.remainingUserActions.length > 0
      ? completion.remainingUserActions.map((item) => `- ${item.label}: ${item.status}`)
      : ["- None recorded"]),
    "",
    "Blockers or failed command/log summary:",
    ...(completion.blockers.length > 0 ? completion.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "Project ZIP archives are not attached to notification emails."
  ].join("\n");
}
