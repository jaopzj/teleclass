// Foto da pessoa (ainda não há upload: mostra a inicial sobre o círculo branco do Figma).
export default function Avatar({ name, size = 80 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
