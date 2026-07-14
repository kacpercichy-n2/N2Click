import test from "node:test";
import assert from "node:assert/strict";
import {
  denialSmokeErrorFor,
  reviewerToolsetErrorFor,
  smokeErrorFor,
} from "./check-claude-permissions.mjs";

const command = "pwd";

function validEvents() {
  return [
    {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command } }],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "/repo",
            is_error: false,
          },
        ],
      },
    },
    { type: "result", subtype: "success", is_error: false, permission_denials: [] },
  ];
}

test("accepts one completed authorized Codex preflight call", () => {
  assert.equal(smokeErrorFor(validEvents(), "pwd", "/repo"), null);
});

test("rejects a final-text-only success without a tool call", () => {
  assert.match(smokeErrorFor([{ type: "result", subtype: "success", is_error: false }]), /one tool call/);
});

test("rejects an additive permission denial or a different command", () => {
  const denied = validEvents();
  denied.at(-1).permission_denials = [{ tool_name: "Bash" }];
  assert.match(smokeErrorFor(denied), /permission denial/);

  const different = validEvents();
  different[0].message.content[0].input.command = "bash scripts/codex-review.sh";
  assert.match(smokeErrorFor(different), /unexpected tool call/);
});

test("accepts evidence that an unlisted direct Codex call was denied", () => {
  const events = [
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tool-2", name: "Bash", input: { command: "codex exec --help" } },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-2", content: "denied", is_error: true },
        ],
      },
    },
    {
      type: "result",
      subtype: "success",
      permission_denials: [
        { tool_use_id: "tool-2", tool_name: "Bash", tool_input: { command: "codex exec --help" } },
      ],
    },
  ];

  assert.equal(denialSmokeErrorFor(events), null);
});

test("rejects a forbidden command that ran without denial evidence", () => {
  const events = [
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tool-2", name: "Bash", input: { command: "codex exec --help" } },
        ],
      },
    },
    { type: "result", subtype: "success", permission_denials: [] },
  ];

  assert.match(denialSmokeErrorFor(events), /no correlated permission denial/);
});

test("rejects a nonzero command result without a correlated permission denial", () => {
  const events = [
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tool-2", name: "Bash", input: { command: "codex exec --help" } },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-2", content: "exit 1", is_error: true },
        ],
      },
    },
    { type: "result", subtype: "success", permission_denials: [] },
  ];

  assert.match(denialSmokeErrorFor(events), /no correlated permission denial/);
});

test("validates the effective reviewer tool list", () => {
  assert.equal(reviewerToolsetErrorFor([
    { type: "system", subtype: "init", tools: ["Read", "Glob", "Grep", "LS"] },
  ]), null);
  assert.match(reviewerToolsetErrorFor([
    { type: "system", subtype: "init", tools: ["Read", "Glob", "Grep", "Bash"] },
  ]), /contains Bash/);
});
