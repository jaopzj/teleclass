import { Fragment, ReactNode } from "react";

// Mostra a descrição da aula (Markdown do Telegram) com links e negrito, sem
// interpretar HTML. O resto do texto aparece como foi escrito.
const TOKEN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|(https?:\/\/[^\s)]+)/g;

function inline(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(line.slice(last, index));
    const [, label, href, bold, italic, bare] = match;
    if (href) parts.push(<a key={index} href={href} target="_blank" rel="noreferrer">{label}</a>);
    else if (bold) parts.push(<strong key={index}>{bold}</strong>);
    else if (italic) parts.push(<em key={index}>{italic}</em>);
    else if (bare) parts.push(<a key={index} href={bare} target="_blank" rel="noreferrer">{bare}</a>);
    last = index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export default function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="rich-text">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {inline(line)}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </div>
  );
}
