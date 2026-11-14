import React from "react";
import ReactDOM from "react-dom/client";
import { changeAppLanguage } from "./i18n";
import "./i18n";
import App from "./App";
import "./index.css";

if (typeof window !== "undefined") {
  (window as unknown as { __kinanaChangeLang?: typeof changeAppLanguage }).__kinanaChangeLang = changeAppLanguage;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
