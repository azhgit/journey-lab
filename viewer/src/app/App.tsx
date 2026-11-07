import { Calls } from "../routes/Calls";
import { GateRuns } from "../routes/GateRuns";
import { Live } from "../routes/Live";
import { Statement } from "../routes/Statement";
import { Link, useLocation, useScrollReset } from "./router";

const NAV = [
  { to: "/", label: "Statement", match: (p: string) => p === "/" },
  { to: "/calls", label: "Calls", match: (p: string) => p.startsWith("/calls") },
  { to: "/gate", label: "Gate runs", short: "Gate", match: (p: string) => p.startsWith("/gate") },
  { to: "/live", label: "Live call", short: "Live", match: (p: string) => p.startsWith("/live") },
];

export function App() {
  const { path, query } = useLocation();
  useScrollReset(path);
  const [, section = "", id] = path.split("/");

  let page;
  if (section === "") page = <Statement />;
  else if (section === "calls") page = <Calls id={id === undefined ? null : decodeURIComponent(id)} query={query} />;
  else if (section === "gate") page = <GateRuns id={id === undefined ? null : decodeURIComponent(id)} query={query} />;
  else if (section === "live") page = <Live query={query} />;
  else
    page = (
      <main className="page page--narrow">
        <h1>Not on this statement</h1>
        <p className="lede">
          There is no page at <code>{path}</code>. <Link to="/">Go to the statement</Link>.
        </p>
      </main>
    );

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="nav">
        <div className="nav__inner">
          <Link to="/" className="wordmark" aria-label="journey-lab, statement of evidence">
            <span className="wordmark__band" aria-hidden="true" />
            <span className="wordmark__company">Northwind Lending</span>
            <span className="wordmark__product">journey-lab</span>
          </Link>
          <nav aria-label="Main">
            <ul className="nav__links">
              {NAV.map((n) => (
                <li key={n.to}>
                  <Link to={n.to} className="nav__link" aria-current={n.match(path) ? "page" : undefined}>
                    {"short" in n ? (
                      <>
                        <span className="nav__long">{n.label}</span>
                        <span className="nav__short">{n.short}</span>
                      </>
                    ) : (
                      n.label
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <div id="main">{page}</div>
      <footer className="colophon">
        <div className="colophon__inner">
          <p>Modeled on public descriptions of agent platforms. Not built on Sierra. Fictional company and data.</p>
          <p>Northwind Lending, its customers, loans, and accounts are invented. No real telephony, SMS, or money.</p>
        </div>
      </footer>
    </>
  );
}
