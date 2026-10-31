import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/host-grotesk/wght.css";
import "@fontsource/poppins/latin-600.css";
import "./ui/tokens.css";
import "./ui/primitives.css";
import "./styles.css";
import "./layout/shell.css";
import "./auth/auth.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
