import Icon from "../../components/Icon";

export interface StepItem {
  key: string;
  label: string;
}

/** Indicador de etapas. Etapas que surgem no caminho (ex.: 2FA) entram na lista. */
export default function Stepper({ steps, current }: { steps: StepItem[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Etapas do cadastro">
      {steps.map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={step.key} className={`stepper-item is-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="stepper-dot">{state === "done" ? <Icon name="check" size={12} /> : i + 1}</span>
            <span className="stepper-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
