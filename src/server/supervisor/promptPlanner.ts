import type { ProjectDetail } from "../projects/service.js";

export type SupervisorNextPrompt = {
  projectId: string;
  prompt: string;
  wordCount: number;
  source: "worker_option" | "user_instruction" | "blocked_checklist" | "progress_gate" | "final_summary";
  usesQueuedInstructionId: string | null;
};

export function planNextWorkerPrompt(project: ProjectDetail): SupervisorNextPrompt {
  const option = chooseWorkerOption(project.latestWorkerResponse);
  if (option) {
    return result(project.id, option, "worker_option", null);
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
      queuedInstruction.id
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
      null
    );
  }

  const nextGate = project.progress.gates.find((gate) => gate.status === "pending");
  if (nextGate) {
    return result(
      project.id,
      [
        `Advance the roadmap gate: ${nextGate.label}.`,
        `Phase: ${nextGate.phase}.`,
        "Perform the needed worker task yourself, including any code review, planning, research, or verification appropriate for this gate.",
        "Do not run emulator/device verification unless this gate explicitly requires the QA/emulator phase.",
        "Acceptance: provide evidence, changed files or artifacts, verification tier, blockers, and next A-G options."
      ].join(" "),
      "progress_gate",
      null
    );
  }

  return result(
    project.id,
    [
      "Prepare final production-readiness summary.",
      "Verify all roadmap gates, checklist items, artifacts, and verification evidence from backend state.",
      "Do not inspect source directly unless you are the worker performing the verification task.",
      "Acceptance: state whether production-level implementation is ready and list only user-owned remaining actions."
    ].join(" "),
    "final_summary",
    null
  );
}

function chooseWorkerOption(workerResponse: string | null): string | null {
  if (!workerResponse) {
    return null;
  }
  const optionPattern = /^\s*([A-G])[).:\s-]/gm;
  const matches = [...workerResponse.matchAll(optionPattern)];
  return matches[0]?.[1] ?? null;
}

function result(
  projectId: string,
  prompt: string,
  source: SupervisorNextPrompt["source"],
  usesQueuedInstructionId: string | null
): SupervisorNextPrompt {
  const cappedPrompt = capWords(prompt, 300);
  return {
    projectId,
    prompt: cappedPrompt,
    wordCount: wordCount(cappedPrompt),
    source,
    usesQueuedInstructionId
  };
}

function capWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ") : value.trim();
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
