import { CSSProperties, useState } from "react";
import Icon from "../components/Icon";
import {
  CATEGORIES,
  clearAmbientError,
  pauseAmbient,
  removeSound,
  resumeAmbient,
  setMasterVolume,
  setSoundVolume,
  Sound,
  SoundCategory,
  soundById,
  SOUNDS,
  stopAmbient,
  toggleFavorite,
  toggleSound,
  useAmbient,
} from "./ambient";

type Filter = "all" | "favorites" | SoundCategory;

/** Aba Som ambiente: catálogo, mixagem com volumes individuais e geral, favoritos e recentes. */
export default function AmbientView() {
  const a = useAmbient();
  const [filter, setFilter] = useState<Filter>("all");

  if (!a.supported) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="mute" size={24} />
        </span>
        <h2>Som ambiente indisponível</h2>
        <p>Este navegador não tem suporte a áudio gerado na página. O temporizador funciona normalmente.</p>
      </div>
    );
  }

  const list = SOUNDS.filter((s) => (filter === "all" ? true : filter === "favorites" ? a.favorites.includes(s.id) : s.category === filter));
  const filters: [Filter, string][] = [["all", "Todos"], ["favorites", "Favoritos"], ...CATEGORIES.map((c) => [c.id, c.name] as [Filter, string])];

  return (
    <div className="fx-amb">
      <Mixer />

      {a.error && (
        <div className="fx-amb-error" role="alert">
          <Icon name="warningCircle" size={18} />
          <span>{a.error}</span>
          <button type="button" className="icon-button icon-button-sm" onClick={clearAmbientError} aria-label="Dispensar aviso">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <section className="fx-amb-library" aria-labelledby="fx-amb-title">
        <div className="fx-section-head">
          <h2 id="fx-amb-title" className="fx-card-title">
            Catálogo
          </h2>
          <div className="fx-chips" role="radiogroup" aria-label="Filtrar sons">
            {filters.map(([key, label]) => (
              <button key={key} type="button" role="radio" aria-checked={filter === key} className="fx-chip" onClick={() => setFilter(key)}>
                {key === "favorites" && <Icon name="star" size={14} weight={filter === key ? "fill" : undefined} />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {filter === "all" && a.recent.length > 0 && (
          <div className="fx-recent">
            <span className="fx-label">Recentes</span>
            <ul>
              {a.recent.map((id) => {
                const s = soundById(id);
                const on = a.mix.includes(id);
                return (
                  <li key={id}>
                    <button type="button" className="fx-chip" aria-pressed={on} onClick={() => void toggleSound(id)}>
                      <Icon name={s.icon} size={15} />
                      {s.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {list.length === 0 ? (
          <p className="fx-empty-inline">
            <Icon name="star" size={18} /> Marque a estrela de um som para encontrá-lo aqui.
          </p>
        ) : (
          <ul className="fx-sounds">
            {list.map((s) => (
              <li key={s.id}>
                <SoundCard sound={s} />
              </li>
            ))}
          </ul>
        )}
        <p className="fx-hint">Os sons são gerados no próprio navegador, sem download. Volumes, favoritos e recentes ficam guardados neste dispositivo.</p>
      </section>
    </div>
  );
}

function SoundCard({ sound }: { sound: Sound }) {
  const a = useAmbient();
  const on = a.mix.includes(sound.id);
  const playing = on && a.status === "playing";
  const fav = a.favorites.includes(sound.id);
  return (
    <article className={`surface fx-sound ${on ? "is-on" : ""}`}>
      <div className="fx-sound-top">
        <span className="fx-sound-tile" aria-hidden="true">
          <Icon name={sound.icon} size={22} />
        </span>
        <button
          type="button"
          className={`icon-button icon-button-sm fx-fav ${fav ? "is-on" : ""}`}
          aria-pressed={fav}
          aria-label={fav ? `Remover ${sound.name} dos favoritos` : `Favoritar ${sound.name}`}
          onClick={() => toggleFavorite(sound.id)}
        >
          <Icon name="star" size={18} weight={fav ? "fill" : undefined} />
        </button>
      </div>
      <div className="fx-sound-text">
        <h3>{sound.name}</h3>
        <p>{sound.description}</p>
      </div>
      <div className="fx-sound-controls">
        <button
          type="button"
          className={`fx-play ${on ? "is-on" : ""}`}
          aria-pressed={on}
          aria-label={on ? `Tirar ${sound.name} da mixagem` : `Tocar ${sound.name}`}
          onClick={() => void toggleSound(sound.id)}
        >
          <Icon name={on ? "stop" : "play"} size={16} weight={on ? undefined : "fill"} />
        </button>
        <Volume label={`Volume de ${sound.name}`} value={a.volumes[sound.id]} onChange={(v) => setSoundVolume(sound.id, v)} />
      </div>
      {playing && <span className="sr-only">Tocando</span>}
    </article>
  );
}

/** "Tocando agora": a mixagem atual com controle geral. */
function Mixer() {
  const a = useAmbient();
  const playing = a.status === "playing";
  return (
    <section className="surface fx-card fx-mixer" aria-labelledby="fx-mixer-title">
      <div className="fx-mixer-head">
        <div>
          <h2 id="fx-mixer-title" className="fx-card-title">
            Tocando agora
          </h2>
          <p className="muted">
            {a.mix.length === 0
              ? "Escolha um ou mais sons no catálogo. Eles seguem tocando enquanto você navega."
              : playing
                ? `${a.mix.length} ${a.mix.length === 1 ? "som" : "sons"} na mixagem`
                : "Mixagem pausada"}
          </p>
        </div>
        {a.mix.length > 0 && (
          <div className="fx-mixer-actions">
            <button
              type="button"
              className="button button-soft"
              onClick={() => (playing ? pauseAmbient() : void resumeAmbient())}
              disabled={a.status === "stopped"}
            >
              <Icon name={playing ? "pause" : "play"} size={16} weight="fill" />
              {playing ? "Pausar" : "Retomar"}
            </button>
            <button type="button" className="button" onClick={stopAmbient} disabled={a.status === "stopped"}>
              <Icon name="stop" size={16} /> Parar tudo
            </button>
          </div>
        )}
      </div>
      {a.mix.length > 0 && (
        <ul className="fx-mix">
          {a.mix.map((id) => {
            const s = soundById(id);
            return (
              <li key={id} className="fx-mix-row">
                <Icon name={s.icon} size={18} />
                <span className="fx-mix-name">{s.name}</span>
                <Volume label={`Volume de ${s.name}`} value={a.volumes[id]} onChange={(v) => setSoundVolume(id, v)} />
                <button type="button" className="icon-button icon-button-sm" onClick={() => removeSound(id)} aria-label={`Tirar ${s.name} da mixagem`}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            );
          })}
          <li className="fx-mix-row is-master">
            <Icon name={a.master === 0 ? "mute" : "volume"} size={18} />
            <span className="fx-mix-name">Volume geral</span>
            <Volume label="Volume geral" value={a.master} onChange={setMasterVolume} />
            <span className="fx-mix-pad" aria-hidden="true" />
          </li>
        </ul>
      )}
    </section>
  );
}

function Volume({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      className="fx-range"
      min={0}
      max={1}
      step={0.01}
      value={value}
      aria-label={label}
      aria-valuetext={`${Math.round(value * 100)}%`}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ "--v": `${value * 100}%` } as CSSProperties}
    />
  );
}
