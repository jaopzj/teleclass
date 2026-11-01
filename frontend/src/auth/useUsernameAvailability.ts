import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { authApi } from "./api";
import { normalizeUsername, usernameProblem } from "./validation";

export type Availability =
  | { state: "idle" }
  | { state: "invalid"; message: string }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken"; message: string }
  | { state: "unknown" };

/** Confere a disponibilidade do nome enquanto a pessoa digita (com espera de 450 ms). */
export function useUsernameAvailability(raw: string): Availability {
  const [result, setResult] = useState<Availability>({ state: "idle" });
  const latest = useRef(0);

  useEffect(() => {
    const username = normalizeUsername(raw);
    if (!username) return setResult({ state: "idle" });
    const problem = usernameProblem(username);
    if (problem) return setResult({ state: "invalid", message: problem });
    setResult({ state: "checking" });
    const ticket = ++latest.current;
    const timer = window.setTimeout(async () => {
      try {
        const data = await authApi.availability(username);
        if (ticket !== latest.current) return;
        setResult(data.available ? { state: "available" } : { state: "taken", message: data.reason ?? "Indisponível." });
      } catch (e) {
        if (ticket !== latest.current) return;
        // Sem resposta (ou limite atingido): o cadastro confere de novo no envio.
        setResult(e instanceof ApiError && e.status === 429 ? { state: "unknown" } : { state: "unknown" });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [raw]);

  return result;
}
