import Icon from "../components/Icon";
import { Link, paths } from "../router";
import { pauseAmbient, resumeAmbient, soundById, useAmbient } from "./ambient";

/** Som ambiente durante a sessão: o que está tocando, pausar/retomar e o atalho para a aba. */
export default function AmbientMini() {
  const a = useAmbient();
  if (!a.supported) return null;
  const names = a.mix.map((id) => soundById(id).name);
  const playing = a.status === "playing";
  return (
    <div className="fx-amb-mini">
      <span className="fx-amb-mini-icon" aria-hidden="true">
        <Icon name={a.mix.length ? soundById(a.mix[0]).icon : "volume"} size={18} />
      </span>
      <span className="fx-amb-mini-text">
        <span className="fx-label">Som ambiente</span>
        <span>{names.length ? `${names.join(" + ")}${playing ? "" : " · pausado"}` : "Nenhum som tocando"}</span>
      </span>
      {names.length > 0 && (
        <button
          type="button"
          className="icon-button icon-button-sm"
          onClick={() => (playing ? pauseAmbient() : void resumeAmbient())}
          aria-label={playing ? "Pausar som ambiente" : "Retomar som ambiente"}
        >
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
      )}
      <Link className="button button-ghost button-sm" to={paths.focus("som")}>
        {names.length ? "Ajustar" : "Escolher"}
      </Link>
    </div>
  );
}
