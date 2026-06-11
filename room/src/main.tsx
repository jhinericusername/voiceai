import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// NOTE: StrictMode is disabled until InCall.tsx is made fully idempotent
// across remount. See docs/KNOWN_ISSUES.md → "InCall not StrictMode-safe".
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
