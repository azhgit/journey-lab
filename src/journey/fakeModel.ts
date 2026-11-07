// CLAUDE-OWNED (M6). Test helper: a scripted stand-in for the agent model, plus content-block builders.
import type Anthropic from "@anthropic-ai/sdk";
import type { Model, ModelReply, ModelRequest } from "./runner.js";

let nextId = 0;

export const text = (t: string): Anthropic.TextBlock => ({ type: "text", text: t, citations: null });

export const use = (name: string, input: unknown): Anthropic.ToolUseBlock => ({
  type: "tool_use",
  id: `tu_${(nextId += 1)}`,
  name,
  input,
  caller: { type: "direct" },
});

export const reply = (...content: Anthropic.ContentBlock[]): ModelReply => ({
  content,
  stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
  usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
});

// Each step is a reply, or a function of the request (to read something only known at run time).
export type Step = ModelReply | ((req: ModelRequest) => ModelReply);

export function scripted(steps: Step[]): Model & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const model = async (req: ModelRequest) => {
    // Copy: the runner keeps appending to the same array.
    requests.push({ ...req, messages: structuredClone(req.messages) });
    const next = steps.shift();
    if (next === undefined) throw new Error("script exhausted");
    return typeof next === "function" ? next(req) : next;
  };
  return Object.assign(model, { requests });
}
