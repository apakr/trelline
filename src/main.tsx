import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import "./App.css";

// Block the WebView's built-in page-zoom shortcuts (Ctrl+= / Ctrl+-) at the
// earliest possible point so they can't visually rescale the page. Our own
// scale controls handle these keys in TopBar.tsx.
document.addEventListener(
  "keydown",
  (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
      e.preventDefault();
    }
  },
  { capture: true }
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </React.StrictMode>
);
