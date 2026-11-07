// CLAUDE-OWNED (M5). The code-owned floor for every tool. Journeys reference tools by name and may only
// raise `minTier` above this (schema.ts rejects a lower value). The runtime registry with input schemas
// and run functions arrives in M6 and is keyed by the same names.

export const TOOL_NAMES = [
  "getLoanDetails",
  "listLinkedAccounts",
  "preparePayment",
  "makePayment",
  "sendStepUpCode",
  "checkStepUpCode",
  "updateAutopay",
  "searchKnowledge",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type AuthTier = 0 | 1 | 2;

export type ToolMeta = { minTier: AuthTier; description: string };

// `satisfies` checks every name is present with the right shape, but keeps the literal types
// (TOOL_CATALOG.updateAutopay.minTier is `2`, not `AuthTier`).
export const TOOL_CATALOG = {
  getLoanDetails: { minTier: 1, description: "Status, balances, next payment and autopay for one loan." },
  listLinkedAccounts: { minTier: 1, description: "Bank accounts linked to one loan (bank name and last 4 only)." },
  preparePayment: { minTier: 1, description: "Validate an amount and account and create a quote to read back. Does not pay." },
  makePayment: { minTier: 1, description: "Pay a quote the caller has confirmed. Takes only the quote id." },
  // Tier 0 by design: step-up is how an unverified caller reaches Tier 2.
  sendStepUpCode: { minTier: 0, description: "Text a one-time code to the phone on file for a loan." },
  checkStepUpCode: { minTier: 0, description: "Check the one-time code the caller read out." },
  updateAutopay: { minTier: 2, description: "Turn autopay on (with a linked account) or off." },
  searchKnowledge: { minTier: 0, description: "Search help articles for general questions." },
} as const satisfies Record<ToolName, ToolMeta>;

export const STEP_UP_TOOLS = ["sendStepUpCode", "checkStepUpCode"] as const satisfies readonly ToolName[];
