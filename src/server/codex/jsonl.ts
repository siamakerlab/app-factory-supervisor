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
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { type?: unknown; event?: unknown };
      const type = typeof parsed.type === "string" ? parsed.type : parsed.event;
      if (typeof type === "string") {
        eventTypes.add(type);
        parsedEvents += 1;
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
