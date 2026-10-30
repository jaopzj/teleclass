import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Carrega um recurso e o recarrega quando `key` muda. Mantém o dado anterior
 * enquanto o novo chega (troca de aula sem piscar a tela).
 */
export function useResource<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loadedKey, setLoadedKey] = useState<string>();
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(() => {
    let active = true;
    setError(undefined);
    loader
      .current()
      .then((value) => {
        if (!active) return;
        setData(value);
        setLoadedKey(key);
      })
      .catch((e: Error) => active && setError(e));
    return () => {
      active = false;
    };
  }, [key]);

  useEffect(reload, [reload]);

  return { data, error, loading: loadedKey !== key && !error, setData, reload };
}
