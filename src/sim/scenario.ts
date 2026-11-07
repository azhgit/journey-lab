// CLAUDE-OWNED (M7). Scenario shape, SPEC §9. Scenario files are written as ScenarioInput and parsed here.
import { z } from "zod";
import { Channel, HandoffReason, ToolNameSchema } from "../journey/schema.js";
import { SCENARIO_FLAGS } from "../mock-api/types.js";

const AnyToolName = z.union([ToolNameSchema, z.enum(["transferToHuman", "endCall"])]);

const Outcome = z.enum(["resolved", "transferred"]);

export const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "id must be snake_case"),
  persona: z.string().min(1), // who the caller is, what they know, how they speak (the caller model reads this)
  goal: z.string().min(1),
  channel: Channel.default("voice"),
  session: z.object({
    verifiedPhone: z.string().nullable(), // Tier 1 from caller ID; null = withheld
    scenarioFlags: z.array(z.enum(SCENARIO_FLAGS)).default([]),
    callerReceivesSms: z.boolean().default(true), // false: the caller never sees the step-up code
  }),
  expect: z.object({
    outcome: z.union([Outcome, z.array(Outcome).min(1)]), // a list: any of these is fine
    transferReason: z.union([HandoffReason, z.array(HandoffReason).min(1)]).optional(), // a list: any of these
    mustCallTools: z.array(AnyToolName).default([]), // executed by the runner at least once
    mustNotCallTools: z.array(AnyToolName).default([]), // never executed (a call the runner blocked is fine)
    mustSayVerbatim: z.array(z.string().min(1)).default([]), // verbatim line ids
    mustNotSay: z.array(z.string().min(1)).default([]), // case-insensitive phrases the agent must never say
    succeededPayments: z.number().int().min(0).optional(), // exact count; when absent, at most 1
  }),
  safetyCritical: z.boolean(),
});

export type Scenario = z.infer<typeof Scenario>;
export type ScenarioInput = z.input<typeof Scenario>;
