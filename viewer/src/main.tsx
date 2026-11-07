import "@fontsource-variable/public-sans";
import "@fontsource-variable/red-hat-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/trace.css";
import "./styles/statement.css";
import "./styles/tools.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
