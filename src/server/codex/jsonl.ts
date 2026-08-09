export const knownCodexJsonEventTypes = [
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "error"
] as const;

export type CodexJsonEventSummary = {
  totalLines: number;
  parsedEvents: number;
  malformedLines: number;
  eventTypes: string[];
  eventCategories: {
    threadStarted: number;
    turnStarted: number;
    turnCompleted: number;
    turnFailed: number;
    itemEvents: number;
    errors: number;
    unknown: number;
  };
  threadId: string | null;
  tokenUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    reasoningOutputTokens: number | null;
  };
  finalMessage: string | null;
  failedCommands: Array<{
    eventType: string;
    command: string | null;
    exitCode: number | null;
    summary: string;
  }>;
  schemaVersionSensitive: boolean;
  requiredEventsRecognized: boolean;
};

const requiredEventPatterns = [
  /^thread\.started$/,
  /^turn\.started$/,
  /^turn\.completed$/,
  /^turn\.failed$/,
  /^item\./,
  /^error$/
];

export function summarizeCodexJsonl(jsonl: string): CodexJsonEventSummary {
  const eventTypes = new Set<string>();
  let parsedEvents = 0;
  let malformedLines = 0;
  const eventCategories = {
    threadStarted: 0,
    turnStarted: 0,
    turnCompleted: 0,
    turnFailed: 0,
    itemEvents: 0,
    errors: 0,
    unknown: 0
  };
  let threadId: string | null = null;
  let finalMessage: string | null = null;
  let tokenUsage: CodexJsonEventSummary["tokenUsage"] = {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningOutputTokens: null
  };
  const failedCommands: CodexJsonEventSummary["failedCommands"] = [];
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const type = typeof parsed.type === "string" ? parsed.type : parsed.event;
      if (typeof type === "string") {
        eventTypes.add(type);
        parsedEvents += 1;
        incrementCategory(eventCategories, type);
        threadId ??= extractThreadId(parsed, type);
        tokenUsage = mergeTokenUsage(tokenUsage, extractTokenUsage(parsed));
        finalMessage = extractFinalMessage(parsed) ?? finalMessage;
        const failedCommand = extractFailedCommand(parsed, type);
        if (failedCommand) {
          failedCommands.push(failedCommand);
        }
      } else {
        malformedLines += 1;
      }
    } catch {
      malformedLines += 1;
    }
  }

  return {
    totalLines: lines.length,
    parsedEvents,
    malformedLines,
    eventTypes: [...eventTypes].sort(),
    eventCategories,
    threadId,
    tokenUsage,
    finalMessage,
    failedCommands,
    schemaVersionSensitive: true,
    requiredEventsRecognized: parserRecognizesRequiredCodexEvents()
  };
}

export function parserRecognizesRequiredCodexEvents(): boolean {
  return requiredEventPatterns.every((pattern) =>
    [
      "thread.started",
      "turn.started",
      "turn.completed",
      "turn.failed",
      "item.completed",
      "error"
    ].some((eventType) => pattern.test(eventType))
  );
}

function incrementCategory(
  categories: CodexJsonEventSummary["eventCategories"],
  eventType: string
): void {
  if (eventType === "thread.started") {
    categories.threadStarted += 1;
  } else if (eventType === "turn.started") {
    categories.turnStarted += 1;
  } else if (eventType === "turn.completed") {
    categories.turnCompleted += 1;
  } else if (eventType === "turn.failed") {
    categories.turnFailed += 1;
  } else if (eventType.startsWith("item.")) {
    categories.itemEvents += 1;
  } else if (eventType === "error") {
    categories.errors += 1;
  } else {
    categories.unknown += 1;
  }
}

function extractThreadId(event: Record<string, unknown>, eventType: string): string | null {
  if (eventType !== "thread.started") {
    return null;
  }
  return firstString(event.thread_id, event.threadId, readPath(event, ["thread", "id"]));
}

function extractTokenUsage(
  event: Record<string, unknown>
): CodexJsonEventSummary["tokenUsage"] | null {
  const usage = findObjectByKey(event, "usage") ?? event;
  const inputTokens = firstNumber(
    readPath(usage, ["input_tokens"]),
    readPath(usage, ["inputTokens"]),
    readPath(usage, ["prompt_tokens"]),
    readPath(usage, ["promptTokens"])
  );
  const outputTokens = firstNumber(
    readPath(usage, ["output_tokens"]),
    readPath(usage, ["outputTokens"]),
    readPath(usage, ["completion_tokens"]),
    readPath(usage, ["completionTokens"])
  );
  const totalTokens = firstNumber(
    readPath(usage, ["total_tokens"]),
    readPath(usage, ["totalTokens"])
  );
  const reasoningOutputTokens = firstNumber(
    readPath(usage, ["reasoning_output_tokens"]),
    readPath(usage, ["reasoningOutputTokens"]),
    readPath(usage, ["output_tokens_details", "reasoning_tokens"]),
    readPath(usage, ["outputTokensDetails", "reasoningTokens"])
  );

  if (
    inputTokens === null &&
    outputTokens === null &&
    totalTokens === null &&
    reasoningOutputTokens === null
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningOutputTokens
  };
}

function mergeTokenUsage(
  current: CodexJsonEventSummary["tokenUsage"],
  next: CodexJsonEventSummary["tokenUsage"] | null
): CodexJsonEventSummary["tokenUsage"] {
  if (!next) {
    return current;
  }
  return {
    inputTokens: next.inputTokens ?? current.inputTokens,
    outputTokens: next.outputTokens ?? current.outputTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
    reasoningOutputTokens: next.reasoningOutputTokens ?? current.reasoningOutputTokens
  };
}

function extractFinalMessage(event: Record<string, unknown>): string | null {
  const role = firstString(
    readPath(event, ["role"]),
    readPath(event, ["item", "role"]),
    readPath(event, ["message", "role"])
  );
  const itemType = firstString(
    readPath(event, ["item", "type"]),
    readPath(event, ["message", "type"]),
    readPath(event, ["type"])
  );
  if (role && role !== "assistant") {
    return null;
  }
  if (itemType && !["message", "assistant_message", "item.completed"].includes(itemType)) {
    return null;
  }
  return firstTextFromValue(
    readPath(event, ["item", "content"]),
    readPath(event, ["message", "content"]),
    readPath(event, ["content"]),
    readPath(event, ["item", "text"]),
    readPath(event, ["message", "text"]),
    readPath(event, ["text"])
  );
}

function extractFailedCommand(
  event: Record<string, unknown>,
  eventType: string
): CodexJsonEventSummary["failedCommands"][number] | null {
  const status = firstString(
    readPath(event, ["status"]),
    readPath(event, ["item", "status"]),
    readPath(event, ["result", "status"])
  );
  const exitCode = firstNumber(
    readPath(event, ["exit_code"]),
    readPath(event, ["exitCode"]),
    readPath(event, ["item", "exit_code"]),
    readPath(event, ["item", "exitCode"]),
    readPath(event, ["result", "exit_code"]),
    readPath(event, ["result", "exitCode"])
  );
  const errorMessage = firstString(
    readPath(event, ["error"]),
    readPath(event, ["message"]),
    readPath(event, ["item", "error"]),
    readPath(event, ["result", "error"])
  );
  const failed =
    eventType === "turn.failed" ||
    eventType === "error" ||
    status === "failed" ||
    status === "error" ||
    (exitCode !== null && exitCode !== 0);
  if (!failed) {
    return null;
  }
  const command = firstString(
    readPath(event, ["command"]),
    readPath(event, ["item", "command"]),
    readPath(event, ["item", "call", "command"]),
    readPath(event, ["tool", "name"]),
    readPath(event, ["item", "tool", "name"])
  );
  return {
    eventType,
    command,
    exitCode,
    summary: errorMessage ?? status ?? `Failed event: ${eventType}`
  };
}

function findObjectByKey(value: unknown, key: string, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || !isRecord(value)) {
    return null;
  }
  const candidate = value[key];
  if (isRecord(candidate)) {
    return candidate;
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findObjectByKey(item, key, depth + 1);
        if (found) {
          return found;
        }
      }
    } else {
      const found = findObjectByKey(child, key, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function firstTextFromValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = textFromValue(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function textFromValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => textFromValue(item)).filter((text): text is string => text !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (!isRecord(value)) {
    return null;
  }
  return firstTextFromValue(value.text, value.output_text, value.content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
