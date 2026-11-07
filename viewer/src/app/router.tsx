// A minimal History API router: five routes do not need a dependency.
import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};
const location = () => window.location.pathname + window.location.search;

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === location()) return;
  if (opts.replace === true) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  for (const fn of listeners) fn();
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const loc = useSyncExternalStore(subscribe, location);
  const [path = "/", search = ""] = loc.split("?");
  return { path, query: new URLSearchParams(search) };
}

// A new route starts at the top, unless it targets an anchor.
export function useScrollReset(path: string): void {
  useEffect(() => {
    if (window.location.hash === "") window.scrollTo({ top: 0 });
  }, [path]);
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handle} {...rest} />;
}
