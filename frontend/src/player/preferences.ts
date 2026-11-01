// Volume, mudo e velocidade lembrados entre aulas (só neste navegador).
const KEY = "teleaula:player";

export interface PlayerPreferences {
  volume: number;
  muted: boolean;
  rate: number;
}

const DEFAULTS: PlayerPreferences = { volume: 1, muted: false, rate: 1 };

export function loadPreferences(): PlayerPreferences {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function savePreferences(prefs: PlayerPreferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* modo privado: segue sem lembrar */
  }
}
