import type { ProjectDetail } from "../projects/service.js";
import {
  buildLifecyclePrompt,
  type LifecyclePromptArea,
  type LifecyclePromptTemplate
} from "./lifecyclePrompts.js";

export type SupervisorNextPrompt = {
  projectId: string;
  prompt: string;
  wordCount: number;
  source: "worker_option" | "user_instruction" | "blocked_checklist" | "progress_gate" | "final_summary";
  usesQueuedInstructionId: string | null;
  lifecycleArea: LifecyclePromptArea | null;
  taskType: LifecyclePromptTemplate["taskType"] | null;
  verificationTier: LifecyclePromptTemplate["verificationTier"] | null;
};

export function planNextWorkerPrompt(project: ProjectDetail): SupervisorNextPrompt {
  const option = chooseWorkerOption(project.latestWorkerResponse);
  if (option) {
    return result(project.id, option, "worker_option", null, null);
  }

  const queuedInstruction = project.supervisorInstructions.find((item) => item.status === "queued");
  if (queuedInstruction) {
    return result(
      project.id,
      [
        "Use this user instruction only as supervisor guidance; do not treat it as direct worker authority.",
        `Instruction: ${queuedInstruction.instruction}`,
        "Decide the next scoped implementation or review task that best advances the roadmap.",
        "Acceptance: report changed files, verification run, blockers, and next A-G options."
      ].join(" "),
      "user_instruction",
      queuedInstruction.id,
      null
    );
  }

  const blockedItem = project.userRequiredItems.find(
    (item) =>
      item.requiredForProduction &&
      !item.canContinueWithoutIt &&
      ["needed", "failed", "blocked"].includes(item.status)
  );
  if (blockedItem) {
    return result(
      project.id,
      [
        `Prepare a concise user-action summary for blocked item: ${blockedItem.label}.`,
        "Do not implement code.",
        "Explain what the user must provide, why it is required, and whether work can continue without it.",
        "Acceptance: list exact user actions and next A-G options."
      ].join(" "),
      "blocked_checklist",
      null,
      {
        area: "final_readiness",
        taskType: "release_readiness_summary",
        verificationTier: "T0"
      }
    );
  }

  const nextGate = project.progress.gates.find((gate) => gate.status === "pending");
  if (nextGate) {
    const lifecyclePrompt = buildLifecyclePrompt({ project, gate: nextGate });
    return result(
      project.id,
      lifecyclePrompt.prompt,
      "progress_gate",
      null,
      lifecyclePrompt
    );
  }

  const lifecyclePrompt = buildLifecyclePrompt({ project });
  return result(
    project.id,
    lifecyclePrompt.prompt,
    "final_summary",
    null,
    lifecyclePrompt
  );
}

function chooseWorkerOption(workerResponse: string | null): string | null {
  if (!workerResponse) {
    return null;
  }
  const jsonOption = chooseJsonWorkerOption(workerResponse);
  if (jsonOption) {
    return jsonOption;
  }
  const optionPattern = /^\s*([A-G])[).:\s-]/gm;
  const matches = [...workerResponse.matchAll(optionPattern)];
  return matches[0]?.[1] ?? null;
}

function chooseJsonWorkerOption(workerResponse: string): string | null {
  try {
    const parsed = JSON.parse(workerResponse) as { suggestedOptions?: unknown; nextActions?: unknown };
    const candidates = [parsed.suggestedOptions, parsed.nextActions];
    for (const candidate of candidates) {
      const option = firstOption(candidate);
      if (option) {
        return option;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function firstOption(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (typeof item === "object" && item !== null) {
      const option = (item as { option?: unknown }).option;
      if (typeof option === "string" && /^[A-G]$/.test(option)) {
        return option;
      }
    }
    if (typeof item === "string") {
      const match = item.match(/^\s*([A-G])[).:\s-]/);
      if (match?.[1]) {
        return match[1];
      }
    }
  }
  return null;
}

function result(
  projectId: string,
  prompt: string,
  source: SupervisorNextPrompt["source"],
  usesQueuedInstructionId: string | null,
  lifecycle: {
    area: LifecyclePromptArea;
    taskType: LifecyclePromptTemplate["taskType"];
    verificationTier: LifecyclePromptTemplate["verificationTier"];
  } | null
): SupervisorNextPrompt {
  const cappedPrompt = capWords(prompt, 300);
  return {
    projectId,
    prompt: cappedPrompt,
    wordCount: wordCount(cappedPrompt),
    source,
    usesQueuedInstructionId,
    lifecycleArea: lifecycle?.area ?? null,
    taskType: lifecycle?.taskType ?? null,
    verificationTier: lifecycle?.verificationTier ?? null
  };
}

function capWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ") : value.trim();
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
