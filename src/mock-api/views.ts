import type { Store } from "./store.js";
import type { Loan, ScenarioFlag } from "./types.js";

export type LoanView = Loan & { customer: { id: string; phone: string } };

// The loan as a client sees it, with failure-injection overlays applied.
export function loanView(store: Store, loan: Loan, flags: ReadonlySet<ScenarioFlag>): LoanView {
  const customer = store.customers.get(loan.customerId);
  if (!customer) throw new Error(`seed bug: loan ${loan.id} has no customer`);
  return {
    ...structuredClone(loan),
    status: flags.has("past_due_account") && loan.status === "current" ? "past_due" : loan.status,
    customer: { id: customer.id, phone: customer.phone },
  };
}
