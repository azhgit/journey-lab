// HUMAN-OWNED (M1). SPEC §8.1. Tests: src/lib/result.test.ts

// TODO(M1): replace `unknown` with a discriminated union on `ok`:
//   success → { ok: true; data: T }
//   failure → { ok: false; error: E }
export type Result<T, E> = 
  | {ok: true; data: T } 
  | {ok: false; error: E };  

// TODO(M1): build the success variant.
export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

// TODO(M1): build the failure variant.
export function err<E>(error: E): Result<never, E> {
  return  { ok: false, error };
}
