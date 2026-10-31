# Identidade visual

Referência: Figma "Dashboard" (frame `2:4`). A tela inicial é a primeira aplicação
do padrão; as próximas telas devem usar as mesmas peças antes de criar novas.

## Fundamentos (`frontend/src/ui/tokens.css`)

| | |
|---|---|
| Fundo | `--canvas` #D7E5ED; superfícies brancas (`--surface`) |
| Cor principal | `--brand-500` #13A5E4: ativo, progresso, ícones. Texto e botões sobre branco usam `--brand-700` (contraste AA) |
| Apoio | `--brand-100` capas, `--brand-a08/a26/a30` áreas translúcidas, `--brand-300` e `--steel-600` em gráficos |
| Sequência | `--gradient-streak` (#E44313 → #FFCC00 em 71%), só no destaque da sequência |
| Texto | `--ink` títulos, `--ink-2` valores, `--ink-3` texto secundário, `--ink-4` rótulos grandes |
| Tipografia | Host Grotesk (variável, 400–800); Poppins SemiBold só no nome "teleclass". Escala: 48 / 36 / 32 / 24 / 20 / 16 / 14 / 12 (`--text-*`, fluida nos maiores) |
| Raios | 25 cartões, 15 blocos internos, 50 barra lateral, pílula em campos e botões |
| Sombra | só em cartões de curso (`--shadow-card`) e menus (`--shadow-pop`) |
| Movimento | 120 / 200 / 360 ms, `--ease-out`; zerados com `prefers-reduced-motion` |
| Ícones | Phosphor, peso regular (fill/bold pontuais), pelo componente `Icon` |

## Componentes

- `ui/primitives.css`: `.surface`, `.section-title`, `.title-row`, botões (`.button` +
  `-primary/-soft/-ghost/-danger`, `.icon-button`), `.badge`, `.progress`, `.empty`,
  `.skeleton`, `.menu`/`.menu-item`, dicas (`data-tip`), `.scrim`.
- `components/`: `Icon`, `ProgressBar` (xs/sm/md/lg), `CourseCard`.
- `ui/`: `Logo`, `Avatar`.
- `layout/`: barra lateral (completa ≥ 1280px, trilho de ícones 1024–1279px, gaveta no
  celular), busca de cursos do topo (atalho `/`) e conta.

## Regras

- Valores visuais só por token; nada de cor ou tamanho solto nas telas.
- Azul principal só para o que é ativo, progresso ou ação.
- Layouts de página respondem à largura disponível (container queries), não à janela.
- A interface é clara: o tema escuro automático antigo foi retirado até existir uma
  versão escura da identidade.
