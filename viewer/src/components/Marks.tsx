import type { Outcome } from "../../../src/viewer/types";
import { OUTCOME_LABEL } from "../app/format";
import { Icon } from "./Icon";

export function PassFail({ passed, pass = "Passed", fail = "Failed" }: { passed: boolean; pass?: string; fail?: string }) {
  return passed ? (
    <span className="state-ok">
      <Icon name="check" />
      {pass}
    </span>
  ) : (
    <span className="mark mark--fail">
      <Icon name="cross" />
      {fail}
    </span>
  );
}

export function OutcomeMark({ outcome }: { outcome: Outcome | null }) {
  if (outcome === null) return <span className="mark mark--neutral">In progress</span>;
  return outcome === "resolved" ? <span className="state-ok">{OUTCOME_LABEL[outcome]}</span> : <span className="mark mark--neutral">{OUTCOME_LABEL[outcome]}</span>;
}

export function Loading({ lines = 6, label }: { lines?: number; label: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function Failure({ error, what }: { error: { message: string; status: number }; what: string }) {
  return (
    <div className="notice notice--error" role="alert">
      <p>
        <strong>Could not load {what}.</strong> {error.message}
        {error.status === 0 ? null : ` (HTTP ${error.status})`}
      </p>
    </div>
  );
}
