import { describe, expect, it } from "vitest";

import { parserRecognizesRequiredCodexEvents, summarizeCodexJsonl } from "./jsonl.js";

describe("Codex JSONL parser", () => {
  it("recognizes required Codex exec JSONL event names", () => {
    expect(parserRecognizesRequiredCodexEvents()).toBe(true);
  });

  it("summarizes JSONL while tolerating malformed lines and unknown fields", () => {
    const summary = summarizeCodexJsonl(
      [
        JSON.stringify({ type: "thread.started", extra: true }),
        JSON.stringify({ type: "turn.completed", usage: { total_tokens: 12 } }),
        JSON.stringify({ type: "item.completed", item: { type: "message" } }),
        "not json"
      ].join("\n")
    );

    expect(summary.totalLines).toBe(4);
    expect(summary.parsedEvents).toBe(3);
    expect(summary.malformedLines).toBe(1);
    expect(summary.eventTypes).toEqual(["item.completed", "thread.started", "turn.completed"]);
    expect(summary.requiredEventsRecognized).toBe(true);
  });
});
