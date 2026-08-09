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
        JSON.stringify({ type: "turn.completed", usage: { total_tokens: 12, input_tokens: 5 } }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done." }]
          }
        }),
        "not json"
      ].join("\n")
    );

    expect(summary.totalLines).toBe(4);
    expect(summary.parsedEvents).toBe(3);
    expect(summary.malformedLines).toBe(1);
    expect(summary.eventTypes).toEqual(["item.completed", "thread.started", "turn.completed"]);
    expect(summary.eventCategories.threadStarted).toBe(1);
    expect(summary.eventCategories.turnCompleted).toBe(1);
    expect(summary.eventCategories.itemEvents).toBe(1);
    expect(summary.tokenUsage.totalTokens).toBe(12);
    expect(summary.tokenUsage.inputTokens).toBe(5);
    expect(summary.finalMessage).toBe("Done.");
    expect(summary.schemaVersionSensitive).toBe(true);
    expect(summary.requiredEventsRecognized).toBe(true);
  });

  it("extracts thread ids and failed command summaries without depending on unknown fields", () => {
    const summary = summarizeCodexJsonl(
      [
        JSON.stringify({ type: "thread.started", thread: { id: "thread-123" }, newField: true }),
        JSON.stringify({
          type: "item.completed",
          item: { command: "npm test", exitCode: 1, status: "failed" },
          result: { error: "Tests failed" }
        }),
        JSON.stringify({ type: "error", message: "Tool crashed", arbitrary: { nested: true } })
      ].join("\n")
    );

    expect(summary.threadId).toBe("thread-123");
    expect(summary.failedCommands).toHaveLength(2);
    expect(summary.failedCommands[0]).toMatchObject({
      eventType: "item.completed",
      command: "npm test",
      exitCode: 1,
      summary: "Tests failed"
    });
    expect(summary.eventCategories.errors).toBe(1);
  });
});
