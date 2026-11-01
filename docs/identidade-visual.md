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
| Tipografia | Host Grotesk (variável, 400–800); Poppins SemiBold só no nome "teleclass". Escala compacta: 24→30 / 22→26 / 20→24 / 18 / 16 / 15 / 13 / 12 (`--text-*`; os três maiores crescem pouco entre notebook e monitor). Texto corrido em 15 |
| Raios | 20 cartões, 12 blocos internos, 10 itens pequenos, 32 barra lateral, pílula em campos e botões |
| Sombra | discreta, só em cartões de curso (`--shadow-card`) e menus (`--shadow-pop`) |
| Movimento | 120 / 200 / 360 ms, `--ease-out`; zerados com `prefers-reduced-motion` |
| Ícones | Phosphor, peso regular (fill/bold pontuais), pelo componente `Icon` |

## Estrutura e responsividade

| | |
|---|---|
| Conteúdo | largura máxima `--content-max` (1360px), centrado; margens laterais `--page-pad-x` (20 → 48px). Em monitores grandes sobra fundo dos lados em vez de esticar cartões |
| Topo | busca e conta numa barra fixa de `--topbar-h` (72px; 60px no celular). Áreas presas ao rolar (notas da aula, Caderno, Foco, indexação) descontam esse valor |
| Barra lateral | completa ≥ 1280px (`--sidebar-w`, 232–264px), trilho de ícones 1024–1279px (`--rail-w`), gaveta abaixo de 1024px |
| Espaço | base 4 (`--space-*`); entre blocos de uma página `--stack-gap` (24px) |
| Tela inicial | duas colunas com conteúdo ≥ 960px; abaixo disso a agenda e as estatísticas descem lado a lado; abaixo de 600px tudo empilha e os cursos viram carrossel. Em 1920 × 1080 cabe sem rolar, mesmo descontando a barra do navegador. A chama sai de propósito pelo topo e pela direita do destaque (como no Figma): não a prenda dentro do cartão |

Referência de densidade: navegação com 44px de altura e ícones de 22px, botões de 38px,
cartão de curso com capa de 116px, números de destaque em 24px.

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
- Toda página usa a mesma largura do shell, para alinhar com a busca do topo.
- Títulos dentro de superfícies escuras (palco do Foco, painel do login, capa do curso,
  player) herdam a cor da superfície; para uma nova superfície escura, use `.on-dark`.
- Não reutilize nomes de classes globais (`.sidebar`, `.section-title`, `.stats`...) em
  telas: eles herdam o estilo do shell e da tela inicial.
- A interface é clara: o tema escuro automático antigo foi retirado até existir uma
  versão escura da identidade.
