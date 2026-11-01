// Formatos de link aceitos pela coleta. Espelha `parse_channel_link`
// (backend/app/telegram/links.py): a tela só usa isto para avisar antes de enviar;
// quem decide é o backend, que valida de novo e responde 422 se não reconhecer.

export type LinkKind = "username" | "invite" | "private_id";

export interface ChannelLink {
  kind: LinkKind;
  value: string;
}

const USERNAME = "[A-Za-z][A-Za-z0-9_]{3,31}";
const PATTERNS: [RegExp, LinkKind][] = [
  [new RegExp(`^@(${USERNAME})$`), "username"],
  [/^(?:https?:\/\/)?(?:t|telegram)\.me\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)\/?$/, "invite"],
  [/^(?:https?:\/\/)?(?:t|telegram)\.me\/c\/(\d+)(?:\/(\d+))?\/?$/, "private_id"],
  [new RegExp(`^(?:https?:\\/\\/)?(?:t|telegram)\\.me\\/(?:s\\/)?(${USERNAME})(?:\\/(\\d+))?\\/?$`), "username"],
];

export function parseChannelLink(link: string): ChannelLink | null {
  const text = link.trim().split("?", 1)[0];
  for (const [pattern, kind] of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { kind, value: match[1] };
  }
  return null;
}

/** Exemplos mostrados no cartão de importação, na mesma ordem dos padrões acima. */
export const LINK_EXAMPLES = ["t.me/canal", "@canal", "t.me/+convite", "t.me/c/123456"];
