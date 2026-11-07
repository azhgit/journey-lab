// CLAUDE-OWNED (M6). Adapts the Anthropic SDK to the runner's Model port.
import Anthropic from "@anthropic-ai/sdk";
import type { Model } from "./runner.js";

export type AnthropicModelOptions = {
  model: string; // AGENT_MODEL, e.g. claude-haiku-5-5
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  client?: Anthropic;
};

// Thinking is left at the model default (adaptive) and kept cheap with low effort. Turning thinking off
// can make a model write a tool call as plain text, which would never run.
export function anthropicModel(opts: AnthropicModelOptions): Model {
  const client = opts.client ?? new Anthropic();
  return async ({ system, tools, messages, signal }) => {
    const res = await client.messages.create(
      {
        model: opts.model,
        max_tokens: opts.maxTokens ?? 4096,
        output_config: { effort: opts.effort ?? "low" },
        cache_control: { type: "ephemeral" }, // tools + system are identical for every turn of a call
        system,
        tools,
        messages,
      },
      { signal },
    );
    return {
      content: res.content,
      stopReason: res.stop_reason,
      usage: {
        inputTokens: res.usage.input_tokens,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        outputTokens: res.usage.output_tokens,
      },
    };
  };
}
