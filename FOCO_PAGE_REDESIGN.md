# Planejamento Técnico e Funcional — Reformulação da Página Foco | Teleclass

**Documento:** `FOCO_PAGE_REDESIGN.md`  
**Projeto:** Teleclass  
**Tipo:** Planejamento de UI/UX, arquitetura e comportamento funcional  
**Status:** Especificação para implementação

---

# 1. Visão Geral

Este documento estabelece o planejamento completo para a reformulação da página **Foco** do Teleclass, contemplando sua organização visual, arquitetura funcional, componentes, fluxos de utilização, comportamentos, estados e integração com as demais áreas da aplicação.

O objetivo é transformar a página atual em um ambiente profissional de produtividade e concentração, oferecendo uma experiência intuitiva, consistente e visualmente sofisticada.

A reformulação não deve se limitar a alterações estéticas. É necessário reorganizar a experiência, estabelecer uma hierarquia funcional adequada, eliminar elementos que não pertencem ao escopo da página e aprimorar a integração do temporizador com toda a plataforma.

A experiência deve transmitir simplicidade, modernidade, precisão e fluidez, utilizando referências de qualidade de interfaces como Apple, Linear e Duolingo, sem reproduzir diretamente seus layouts ou estabelecer uma identidade visual independente.

## 1.1. Objetivos principais

- Reformular integralmente a organização da página Foco.
- Estabelecer uma hierarquia clara entre temporizador, estatísticas, histórico e som ambiente.
- Criar uma experiência de configuração e execução de sessões simples e intuitiva.
- Desenvolver um temporizador flutuante persistente, expansível e movimentável.
- Garantir que o temporizador permaneça funcional durante a navegação e a reprodução de aulas em tela cheia.
- Implementar microinterações e animações suaves e consistentes.
- Integrar sessões de concentração ao acompanhamento dos estudos.
- Manter a consistência com o Design System existente no Teleclass.
- Preservar e aprimorar as funcionalidades já implementadas, evitando regressões.

## 1.2. Princípio central da experiência

A página Foco deve funcionar como o centro de gerenciamento da concentração do usuário.

Sua experiência deve ser dividida em duas camadas complementares:

**Camada principal:** ambiente de configuração, execução e acompanhamento das sessões, acessível pela página Foco.

**Camada persistente:** temporizador flutuante que acompanha o usuário durante a utilização da plataforma, independentemente da página acessada.

O temporizador não deve ser tratado como um componente isolado da página Foco. Ele representa uma funcionalidade global do Teleclass.

---

# 2. Escopo Funcional

A página Foco deverá possuir exclusivamente quatro áreas principais:

1. Temporizador.
2. Estatísticas.
3. Histórico.
4. Som ambiente.

Essas áreas deverão ser acessadas por uma navegação secundária horizontal, localizada abaixo do cabeçalho da página.

## 2.1. Funcionalidades que pertencem à página

**Temporizador**
- Seleção de técnicas de concentração.
- Configuração de ciclos.
- Métodos personalizados.
- Configuração de pausas.
- Definição de objetivos.
- Associação com cursos e aulas.
- Início, pausa, retomada e encerramento de sessões.

**Estatísticas**
- Tempo estudado hoje.
- Tempo estudado na semana.
- Tempo estudado no mês.
- Quantidade de ciclos concluídos.
- Sequência de dias de estudo.
- Média diária de concentração.
- Distribuição do tempo por curso.
- Evolução da atividade.

**Histórico**
- Registro cronológico das sessões.
- Consulta dos detalhes de cada sessão.
- Filtros por período, técnica e curso.
- Identificação de sessões concluídas, interrompidas e canceladas.

**Som ambiente**
- Catálogo de sons.
- Categorias.
- Reprodução e pausa.
- Controle de volume.
- Favoritos.
- Reprodução simultânea, caso suportada pela implementação de áudio.
- Integração com as sessões de concentração.

## 2.2. Funcionalidades fora do escopo

Devem ser removidos da página Foco os elementos que não estejam diretamente relacionados à concentração ou ao acompanhamento das sessões.

Não devem permanecer nessa página:

- Sistema de conquistas e XP.
- Níveis de usuário.
- Progressão gamificada independente.
- Metas gerais da plataforma.
- Configurações gerais do aplicativo.
- Preferências globais de conta.
- Funcionalidades administrativas ou de perfil.

Caso existam conquistas e progressão gamificada implementadas, não devem ser removidas indiscriminadamente do projeto. Apenas devem deixar de ocupar espaço na página Foco, podendo permanecer em outro contexto apropriado.

O som ambiente, atualmente associado às configurações, deverá ser disponibilizado também como uma área funcional da página Foco. Preferências globais relacionadas ao áudio podem continuar em Configurações, sem duplicar desnecessariamente a lógica de reprodução.

---

# 3. Identidade Visual e Design System

Esta seção é uma diretriz obrigatória para toda a implementação.

A reformulação deverá utilizar a identidade visual já estabelecida no Teleclass. Não criar uma nova paleta, uma identidade independente ou componentes que pareçam pertencer a outro aplicativo.

## 3.1. Fonte de verdade visual

Antes de iniciar a implementação, analisar o código existente e identificar:

- Variáveis CSS e design tokens.
- Paleta de cores.
- Cores de fundo e superfícies.
- Cor primária e suas variações.
- Cores de estados.
- Tipografia e pesos disponíveis.
- Escala de espaçamento.
- Border radius.
- Sombras.
- Componentes compartilhados.
- Padrões de botões, inputs, cards e navegação.
- Comportamento do tema claro e escuro.

A implementação deverá reutilizar os tokens e componentes encontrados.

Caso existam inconsistências entre páginas, utilizar os padrões mais consolidados do sistema, sem criar soluções visuais isoladas.

## 3.2. Direção visual

A experiência deverá combinar:

- Minimalismo de interfaces Apple.
- Organização e precisão visual de aplicações profissionais como Linear.
- Clareza e acessibilidade das experiências de aprendizagem do Duolingo.
- Microinterações suaves e feedbacks visuais discretos.

A inspiração deve estar na qualidade da experiência, não na reprodução literal de outras interfaces.

## 3.3. Cores

A página deverá utilizar as cores já existentes no Teleclass.

A cor azul da identidade da marca deve continuar sendo o principal destaque para ações, seleções, indicadores ativos e elementos interativos.

As superfícies devem seguir o padrão já utilizado nas demais páginas, respeitando a relação entre o fundo geral, cards, campos e elementos elevados.

Não introduzir novas cores hexadecimais arbitrariamente.

Cores auxiliares poderão ser utilizadas para diferenciar estados de concentração, pausa e conclusão, desde que estejam de acordo com os tokens de estados já existentes ou sejam formalmente incorporadas ao Design System.

O temporizador flutuante poderá utilizar uma superfície escura para garantir legibilidade sobre diferentes conteúdos, mas deverá manter a identidade do Teleclass por meio da tipografia, dos espaçamentos, dos arredondamentos e dos elementos de interação.

## 3.4. Componentes e acabamento

Diretrizes:

- Cards com arredondamentos consistentes.
- Botões com dimensões e raios padronizados.
- Bordas discretas.
- Sombras leves.
- Espaçamentos consistentes.
- Hierarquia tipográfica clara.
- Ícones da mesma biblioteca utilizada no restante da aplicação.
- Estados de hover, focus, active e disabled padronizados.
- Transições suaves.
- Feedback visual adequado para todas as ações.

Evitar excesso de elementos decorativos, gradientes desnecessários, sombras pesadas e bordas excessivamente contrastantes.

## 3.5. Responsividade

A página deverá funcionar adequadamente em diferentes resoluções.

Em telas maiores, priorizar uma composição centralizada com largura controlada.

Em telas intermediárias, adaptar as colunas e reorganizar os cards.

Em telas pequenas, transformar a navegação secundária em uma navegação compacta e reorganizar o temporizador para uma composição vertical.

O Floating Timer também deverá respeitar os limites da viewport, evitando ultrapassar as bordas ou bloquear controles importantes.

---

# 4. Estrutura Geral da Página

A página Foco deverá manter a estrutura global já utilizada no Teleclass:

- Sidebar principal.
- Header global.
- Área de conteúdo.
- Navegação secundária da página.

Não reconstruir a sidebar ou o header global se já existirem componentes compartilhados adequados.

## 4.1. Cabeçalho

O cabeçalho deverá apresentar:

**Título:** Foco.

**Descrição:** Organize seu tempo. Concentre-se no que importa.

À direita, poderão ser apresentados indicadores resumidos da atividade diária, como tempo estudado e ciclos concluídos.

Abaixo do cabeçalho, apresentar a navegação secundária:

- Temporizador.
- Estatísticas.
- Histórico.
- Som ambiente.

A navegação deverá apresentar claramente a seção selecionada, utilizando os padrões de destaque já estabelecidos no Teleclass.

A troca de abas deve preservar o estado da sessão ativa.

## 4.2. Organização do conteúdo

Cada aba deverá possuir sua própria estrutura e responsabilidade.

Evitar que todas as informações sejam exibidas simultaneamente em uma única página.

A interface deverá priorizar a informação mais importante para cada contexto.

---

# 5. Aba Temporizador

Esta será a área principal da página Foco.

Sua responsabilidade é permitir que o usuário configure, inicie e acompanhe sessões de concentração.

A interface deverá apresentar uma composição equilibrada de duas áreas:

- Área de seleção e configuração dos métodos.
- Área de configuração e visualização da sessão.

## 5.1. Seleção de técnicas

Disponibilizar inicialmente os seguintes métodos:

**Pomodoro**
- 25 minutos de concentração.
- 5 minutos de pausa.
- Pausa longa após quatro ciclos.
- Duração da pausa longa configurável.

**52/17**
- 52 minutos de concentração.
- 17 minutos de descanso.

**Deep Work**
- 90 minutos de concentração.
- 20 minutos de descanso.

**Personalizado**
- Tempos definidos pelo usuário.

**Cronômetro livre**
- Contagem crescente.
- Sem duração previamente estabelecida.
- Encerramento manual.

Os valores acima representam os padrões planejados. Os métodos devem permitir configurações adequadas sem comprometer a lógica de execução.

## 5.2. Métodos personalizados

Disponibilizar uma ação para criação de métodos próprios.

O formulário deverá permitir configurar:

- Nome.
- Duração da concentração.
- Duração da pausa curta.
- Duração da pausa longa.
- Intervalo de ciclos para pausa longa.
- Quantidade de ciclos.
- Preferências de repetição, quando aplicável.

Os métodos deverão ser persistidos na conta do usuário.

Também deverão existir opções para editar e excluir métodos personalizados.

A exclusão de um método não deverá alterar retroativamente as sessões já realizadas com ele.

## 5.3. Configuração da sessão

Ao selecionar uma técnica, a área principal deverá atualizar suas informações de acordo com o método escolhido.

Para métodos estruturados, apresentar:

- Tempo de concentração.
- Tempo de pausa.
- Quantidade de ciclos.
- Tempo de pausa longa.
- Representação visual da sequência.
- Duração total estimada.

Adicionar dois campos complementares:

**Objetivo da sessão**

Campo textual opcional para registrar o que o usuário pretende realizar.

Exemplo: "Concluir os exercícios de orientação a objetos".

**Vincular aos estudos**

Seletor opcional de curso e aula.

O seletor deverá permitir que o usuário associe a sessão a um curso ou conteúdo específico.

Quando a sessão for iniciada a partir de uma página de aula, o vínculo deverá ser preenchido automaticamente.

O usuário não deverá precisar selecionar novamente o conteúdo que já está assistindo.

## 5.4. Visualização da sessão

Antes de iniciar, apresentar:

- Técnica selecionada.
- Duração.
- Quantidade de ciclos.
- Etapas de concentração e descanso.
- Objetivo, se definido.
- Curso e aula associados, quando existentes.

A ação principal deverá ser visualmente destacada:

**Começar sessão.**

Evitar controles secundários competindo com essa ação.

## 5.5. Estados da sessão

A sessão deverá possuir estados claramente definidos.

**Idle:** nenhuma sessão em andamento.

**Ready:** método selecionado e configuração pronta.

**Running:** sessão em execução.

**Paused:** sessão temporariamente interrompida.

**Break:** período de descanso em execução.

**Completed:** sessão concluída.

**Interrupted:** sessão encerrada antes da conclusão.

**Cancelled:** sessão cancelada sem contabilização como concluída.

Os estados deverão ser centralizados no mecanismo responsável pelo gerenciamento das sessões.

Não permitir que a página principal e o widget flutuante mantenham estados independentes.

## 5.6. Controles durante a execução

Durante uma sessão, permitir:

- Pausar.
- Retomar.
- Encerrar.
- Consultar a próxima etapa.
- Abrir a visualização completa do temporizador.

Ao encerrar antecipadamente, solicitar confirmação quando houver risco de perda de progresso.

Não registrar automaticamente uma sessão interrompida como ciclo concluído.

---

# 6. Floating Timer — Temporizador Global

Esta é uma das partes mais importantes da reformulação.

O Floating Timer deverá funcionar como uma extensão persistente do sistema de concentração.

Sua experiência visual deverá ser inspirada conceitualmente na Dynamic Island da Apple, com expansão contextual, apresentação compacta e animações naturais.

Não reproduzir literalmente a interface da Apple.

## 6.1. Objetivo

Permitir que o usuário acompanhe e controle sua sessão independentemente da página em que estiver.

O temporizador deverá continuar acessível durante:

- Navegação entre páginas.
- Visualização de cursos.
- Reprodução de aulas.
- Utilização das anotações.
- Reprodução em tela cheia.
- Outras atividades compatíveis com a aplicação.

## 6.2. Posicionamento inicial

Ao iniciar uma sessão, o widget deverá aparecer inicialmente no canto superior direito da área de visualização.

Utilizar espaçamento confortável das bordas, evitando sobreposição com o header e elementos importantes.

A posição inicial poderá ser ajustada conforme a estrutura global da aplicação.

## 6.3. Estado compacto

O estado compacto deverá ocupar o mínimo possível de espaço.

Exibir:

- Indicador de atividade.
- Tempo restante.
- Indicador circular ou linear de progresso.
- Controle de expansão.

O componente deverá possuir boa legibilidade sem chamar excessivamente a atenção.

O usuário deverá conseguir identificar rapidamente se está em concentração, descanso ou pausa.

## 6.4. Estado expandido

Ao interagir com o widget, ele deverá expandir suavemente.

Exibir:

- Tempo restante em destaque.
- Nome da técnica.
- Etapa atual.
- Ciclo atual.
- Progresso da sessão.
- Próxima etapa.
- Objetivo, se existente.
- Curso e aula associados, se existentes.

Controles:

- Pausar ou retomar.
- Encerrar.
- Minimizar.
- Abrir temporizador completo.

A expansão deverá partir visualmente do próprio widget, evitando a impressão de que um card independente foi aberto.

## 6.5. Movimentação

O widget deverá permitir movimentação manual por arrastar e soltar.

Regras:

- Restringir a movimentação aos limites da viewport.
- Evitar que o widget fique parcialmente inacessível.
- Permitir posicionamento em diferentes regiões da tela.
- Implementar acomodação suave próxima às bordas.
- Preservar uma margem mínima de segurança.
- Persistir a posição escolhida pelo usuário.
- Evitar conflitos com elementos interativos importantes.

O encaixe automático deverá ser discreto e previsível.

Não forçar o widget a uma posição inadequada quando o usuário escolher deliberadamente outro local.

## 6.6. Integração com fullscreen

O Floating Timer deverá permanecer visível quando o usuário entrar em tela cheia durante a reprodução de uma aula.

Essa funcionalidade exige atenção especial à arquitetura do player.

Quando um elemento entra em fullscreen por meio da Fullscreen API, apenas a árvore de elementos pertencente ao elemento fullscreen permanece visível.

Portanto, a implementação deverá garantir que o Floating Timer seja renderizado dentro de uma camada compatível com essa árvore.

Não utilizar simplesmente um elemento `position: fixed` fora do contexto fullscreen esperando que ele continue visível.

Comportamentos esperados:

- Permanecer visível durante fullscreen.
- Inicialmente ocupar o canto superior direito.
- Permitir movimentação.
- Permitir expansão e minimização.
- Não bloquear os controles do player.
- Manter sincronização com a sessão.
- Preservar o estado ao sair do fullscreen.

A integração deverá considerar também a possibilidade de o usuário entrar e sair do fullscreen repetidamente.

## 6.7. Estados visuais

O widget deverá possuir apresentações específicas para:

**Concentração:** indicador de atividade e tempo restante.

**Pausa:** apresentação visual distinta, identificando o período de descanso.

**Pausado:** indicador estático, sem animações de atividade.

**Concluído:** feedback visual de conclusão.

**Interrompido:** apresentação neutra, sem indicar falsamente uma sessão concluída.

As cores deverão utilizar os tokens existentes do Teleclass.

## 6.8. Microinterações

Implementar animações suaves para:

- Entrada do widget.
- Expansão.
- Minimização.
- Mudança de posição.
- Encaixe nas bordas.
- Atualização do tempo.
- Alteração entre concentração e descanso.
- Pausa.
- Retomada.
- Conclusão.
- Encerramento.

As animações devem transmitir continuidade e naturalidade.

Evitar efeitos elásticos exagerados, movimentos abruptos, animações excessivamente longas ou pulsação constante.

O tempo deverá ser atualizado visualmente sem tremulação ou mudanças bruscas de largura.

Preferir números tabulares e dimensões estáveis.

Respeitar `prefers-reduced-motion`, oferecendo uma experiência adequada para usuários que desativam animações.

---

# 7. Aba Estatísticas

A aba Estatísticas deverá apresentar uma visão objetiva e organizada do desempenho do usuário.

Seu objetivo é permitir a compreensão da consistência e da evolução dos estudos.

## 7.1. Indicadores principais

Apresentar cards com:

- Tempo estudado hoje.
- Tempo estudado na semana.
- Quantidade de ciclos concluídos.
- Sequência atual de dias estudados.
- Média diária de concentração.

Os indicadores devem utilizar informações reais registradas pela aplicação.

Não apresentar valores fictícios como se fossem dados do usuário.

Quando não houver histórico, apresentar um estado vazio com orientação para iniciar a primeira sessão.

## 7.2. Gráfico de atividade

Implementar um gráfico de tempo estudado.

Permitir selecionar períodos:

- Últimos 7 dias.
- Últimos 30 dias.
- Últimos 90 dias.
- Últimos 12 meses.

O gráfico deverá destacar o período selecionado e apresentar informações detalhadas ao interagir com seus pontos ou barras.

Priorizar legibilidade e simplicidade.

## 7.3. Mapa de consistência

Implementar uma visualização de atividade diária inspirada no mapa de contribuições do GitHub.

Cada célula representará um dia.

A intensidade visual deverá refletir o tempo efetivamente registrado.

Ao interagir com uma célula, apresentar:

- Data.
- Tempo estudado.
- Quantidade de sessões.
- Quantidade de ciclos concluídos.

Dias sem atividade deverão ser visualmente distintos de dias com atividade.

## 7.4. Distribuição dos estudos

Apresentar informações complementares:

- Tempo por curso.
- Distribuição por técnica.
- Horários de maior atividade.
- Evolução mensal.
- Relação entre concentração e descanso.

Essas visualizações deverão ser organizadas em seções secundárias, evitando excesso de informações simultâneas.

## 7.5. Filtros

Permitir selecionar períodos e, quando aplicável, cursos específicos.

A mudança de filtros deverá atualizar os indicadores e gráficos relacionados de forma consistente.

---

# 8. Aba Histórico

O Histórico deverá funcionar como um registro cronológico das sessões realizadas.

## 8.1. Organização

Agrupar sessões por data.

Exibir inicialmente as sessões mais recentes.

Cada registro deverá apresentar:

- Nome do curso ou objetivo.
- Técnica utilizada.
- Horário.
- Quantidade de ciclos.
- Duração efetiva.
- Estado final.

Utilizar cards compactos ou uma timeline organizada.

Evitar tabelas densas e visualmente pesadas.

## 8.2. Filtros

Disponibilizar filtros por:

- Período.
- Técnica.
- Curso.
- Estado da sessão.

Também disponibilizar busca por objetivo ou nome do conteúdo associado.

## 8.3. Detalhes da sessão

Ao selecionar um registro, apresentar:

- Horário de início.
- Horário de término.
- Duração planejada.
- Duração efetiva.
- Técnica.
- Método utilizado.
- Ciclos concluídos.
- Curso associado.
- Aula associada.
- Objetivo.
- Estado final.

A interface deverá distinguir claramente sessões concluídas, interrompidas e canceladas.

## 8.4. Regras de contabilização

Sessões canceladas não deverão ser contabilizadas como ciclos concluídos.

Sessões interrompidas poderão preservar o tempo efetivamente registrado, desde que isso esteja de acordo com a regra de negócio definida.

O tempo de concentração deverá ser separado do tempo de descanso.

Não somar pausas ao tempo estudado.

---

# 9. Aba Som Ambiente

O Som ambiente deverá ser uma área funcional da página Foco.

Sua finalidade é permitir que o usuário configure um ambiente sonoro para acompanhar seus estudos.

## 9.1. Categorias

Organizar os sons em categorias como:

- Natureza.
- Chuva.
- Café.
- Ruído branco.
- Ruído marrom.
- Floresta.
- Oceano.
- Ventilação.
- Música instrumental, quando disponível.

O catálogo deverá ser simples, organizado e visualmente agradável.

## 9.2. Cards de áudio

Cada som deverá apresentar:

- Nome.
- Descrição curta.
- Representação visual.
- Controle de reprodução.
- Controle de volume.

## 9.3. Funcionalidades

Disponibilizar:

- Reproduzir.
- Pausar.
- Parar.
- Ajustar volume.
- Favoritar.
- Consultar sons recentes.
- Reproduzir continuamente durante a sessão.

A possibilidade de mixagem de múltiplos sons deverá depender da arquitetura de áudio existente.

Caso implementada, cada fonte deverá possuir controle de volume individual e um controle geral.

## 9.4. Integração com o temporizador

O usuário poderá escolher sons antes ou durante uma sessão.

A reprodução não deverá ser encerrada simplesmente porque o usuário navegou para outra página.

As preferências de áudio deverão respeitar as configurações de conta e os estados de reprodução definidos pelo usuário.

---

# 10. Fluxo Completo de Utilização

O fluxo ideal deverá ser simples e previsível.

## 10.1. Preparação

O usuário acessa Foco.

Seleciona uma técnica de concentração ou método personalizado.

## 10.2. Configuração

Define a quantidade de ciclos e os tempos aplicáveis.

Opcionalmente, informa um objetivo e associa um curso ou aula.

## 10.3. Ambiente

Seleciona um som ambiente, caso deseje.

Essa etapa não deverá ser obrigatória.

## 10.4. Início

Clica em Começar sessão.

O mecanismo de temporização inicia a sessão e o Floating Timer aparece automaticamente.

## 10.5. Concentração

O usuário pode navegar pelo Teleclass.

O widget acompanha a sessão independentemente da rota atual.

Se estiver assistindo a uma aula, poderá continuar utilizando o player normalmente.

## 10.6. Descanso

Ao concluir um período de concentração, o mecanismo transita para a pausa correspondente.

A interface deverá apresentar a mudança de etapa com feedback visual discreto.

## 10.7. Conclusão

Ao concluir todos os ciclos, a sessão é finalizada.

O registro é persistido e as estatísticas são atualizadas.

O Floating Timer apresenta o feedback de conclusão e recolhe ou desaparece de maneira suave, preservando a possibilidade de consultar o resultado.

---

# 11. Integração com a Página de Cursos e Aulas

A integração entre Foco e a área de estudos deverá ser tratada como requisito funcional.

## 11.1. Início a partir da página Foco

Quando o usuário iniciar uma sessão na página Foco, poderá selecionar um curso e uma aula.

Essas informações deverão ser associadas ao registro da sessão.

## 11.2. Início a partir da página de aula

Quando o usuário iniciar uma sessão diretamente na página de aula:

- Identificar o curso atual.
- Identificar a aula atual.
- Preencher automaticamente o vínculo.
- Iniciar a sessão.
- Exibir o Floating Timer.

O usuário poderá alterar o vínculo quando permitido pela regra de negócio.

## 11.3. Persistência entre páginas

A sessão não deverá ser destruída durante a navegação.

O estado deverá ser compartilhado entre as páginas por meio de uma estrutura global adequada à arquitetura existente.

Não implementar um temporizador independente na página Foco e outro no player.

## 11.4. Relação com o tempo de reprodução

É necessário distinguir:

- Tempo de concentração.
- Tempo de reprodução de vídeo.
- Tempo de descanso.
- Tempo total da sessão.

O tempo de concentração representa o período em que a sessão está efetivamente ativa.

O tempo de reprodução representa a atividade real do player.

Não assumir que todo o tempo de concentração corresponde a tempo de vídeo assistido.

Da mesma forma, não utilizar simplesmente o tempo transcorrido desde a abertura do player para contabilizar estudos.

---

# 12. Arquitetura Técnica Proposta

A arquitetura deverá respeitar a estrutura atual do projeto.

Antes de criar arquivos, analisar os componentes, providers, hooks, serviços e mecanismos de persistência já existentes.

Os nomes abaixo representam uma organização conceitual. Não devem ser tratados como exigência de nomenclatura quando já existirem estruturas equivalentes.

## 12.1. Estrutura conceitual

```text
FocusSessionProvider
│
├── SessionEngine
│   ├── TimerController
│   ├── CycleManager
│   ├── SessionPersistence
│   └── SessionStatistics
│
├── FocusPage
│   ├── FocusHeader
│   ├── FocusNavigation
│   │
│   ├── TimerView
│   │   ├── TechniqueSelector
│   │   ├── CustomMethods
│   │   ├── SessionConfiguration
│   │   └── SessionPreview
│   │
│   ├── StatisticsView
│   │   ├── StatisticsSummary
│   │   ├── ActivityChart
│   │   ├── ConsistencyHeatmap
│   │   └── StudyDistribution
│   │
│   ├── HistoryView
│   │   ├── HistoryFilters
│   │   ├── HistoryTimeline
│   │   └── SessionDetails
│   │
│   └── AmbientSoundsView
│       ├── SoundCategories
│       ├── SoundLibrary
│       └── AudioControls
│
└── FloatingTimer
    ├── CompactWidget
    ├── ExpandedWidget
    ├── DragController
    ├── PositionManager
    └── FullscreenIntegration
```

## 12.2. Responsabilidade do FocusSessionProvider

O provider deverá disponibilizar o estado compartilhado da sessão.

Responsabilidades:

- Expor a sessão atual.
- Expor o estado do temporizador.
- Disponibilizar os métodos de controle.
- Coordenar as transições de estado.
- Compartilhar informações com o Floating Timer.
- Permitir integração com o player.
- Coordenar a persistência.

Não concentrar toda a lógica de negócio em um único componente React.

## 12.3. Responsabilidade do SessionEngine

O SessionEngine deverá ser responsável pela execução da sessão.

Deverá controlar:

- Início.
- Pausa.
- Retomada.
- Encerramento.
- Transição entre etapas.
- Contagem dos ciclos.
- Identificação da próxima etapa.
- Conclusão.

A lógica deverá ser independente da representação visual.

## 12.4. Responsabilidade do TimerController

O TimerController deverá calcular o tempo restante ou transcorrido.

Não utilizar a quantidade de execuções de `setInterval` como fonte de verdade.

A contagem deverá ser baseada em timestamps.

Exemplo conceitual:

```javascript
const remainingTime = Math.max(
  0,
  targetTimestamp - Date.now()
);
```

O mecanismo deverá considerar:

- Timestamp de início.
- Timestamp de término planejado.
- Momento de pausa.
- Tempo acumulado de pausas.
- Retomada.
- Mudança de etapa.

O intervalo visual poderá atualizar a interface periodicamente, mas não deverá determinar o tempo real da sessão.

## 12.5. Responsabilidade do CycleManager

Controlar a sequência de ciclos.

Deverá determinar:

- Ciclo atual.
- Quantidade total de ciclos.
- Tipo da etapa atual.
- Próxima etapa.
- Momento de pausa longa.
- Conclusão da sequência.

As regras de cada técnica deverão ser configuráveis, evitando condicionais duplicadas espalhadas pela aplicação.

## 12.6. Responsabilidade do FloatingTimer

O FloatingTimer deverá consumir o estado compartilhado.

Não deverá possuir uma implementação própria de temporização.

Sua responsabilidade será exclusivamente visual e interativa:

- Exibir o tempo.
- Exibir o progresso.
- Expandir.
- Minimizar.
- Movimentar.
- Persistir posição.
- Integrar-se ao fullscreen.
- Disponibilizar os controles da sessão.

---

# 13. Modelo Conceitual de Dados

A estrutura definitiva deverá respeitar os contratos do backend existente.

Os modelos abaixo são referências conceituais, não contratos de API já existentes.

## 13.1. Método de concentração

```typescript
interface FocusMethod {
  id: string;
  name: string;
  type: "pomodoro" | "52-17" | "deep-work" | "custom" | "stopwatch";

  focusDuration: number;
  shortBreakDuration?: number;
  longBreakDuration?: number;

  cyclesBeforeLongBreak?: number;
  totalCycles?: number;

  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}
```

As durações devem ser armazenadas em uma unidade consistente, preferencialmente segundos.

O cronômetro livre não deverá depender de uma duração fixa.

## 13.2. Sessão de concentração

```typescript
interface FocusSession {
  id: string;

  methodId: string;
  methodName: string;

  status:
    | "idle"
    | "running"
    | "paused"
    | "break"
    | "completed"
    | "interrupted"
    | "cancelled";

  currentPhase: "focus" | "short_break" | "long_break";

  currentCycle: number;
  totalCycles: number;

  plannedDuration: number;
  focusedDuration: number;
  breakDuration: number;

  startedAt?: string;
  endedAt?: string;

  objective?: string;

  courseId?: string;
  lessonId?: string;
}
```

Os campos deverão ser adaptados aos contratos reais da aplicação.

## 13.3. Registro histórico

```typescript
interface FocusSessionRecord {
  id: string;
  sessionId: string;

  methodName: string;

  status: "completed" | "interrupted" | "cancelled";

  startedAt: string;
  endedAt: string;

  plannedDuration: number;
  actualFocusDuration: number;
  actualBreakDuration: number;

  completedCycles: number;

  objective?: string;

  courseId?: string;
  lessonId?: string;
}
```

O histórico deverá ser baseado em registros persistidos, não em valores calculados exclusivamente no frontend.

## 13.4. Posição do Floating Timer

```typescript
interface FloatingTimerPosition {
  x: number;
  y: number;
  anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}
```

O formato definitivo deverá considerar responsividade e alterações nas dimensões da viewport.

---

# 14. Persistência e Recuperação

A sessão deverá continuar consistente mesmo quando o usuário:

- Trocar de página.
- Atualizar o navegador.
- Minimizar a janela.
- Colocar a aplicação em segundo plano.
- Entrar ou sair do fullscreen.
- Perder temporariamente a conexão.

A implementação deverá identificar quais informações precisam ser persistidas localmente e quais precisam ser confirmadas pelo backend.

## 14.1. Recuperação de sessão

Ao reabrir ou atualizar a aplicação, verificar se existe uma sessão ativa.

Se houver, recuperar seu estado e recalcular o tempo a partir dos timestamps persistidos.

Não reiniciar a contagem do zero.

## 14.2. Sincronização

Definir uma estratégia para sincronizar o estado local com o backend.

Evitar gravações excessivas a cada segundo.

Priorizar eventos relevantes:

- Início.
- Pausa.
- Retomada.
- Transição de etapa.
- Encerramento.
- Recuperação.

## 14.3. Conflitos

Impedir sessões simultâneas conflitantes para o mesmo usuário.

Caso exista uma sessão ativa em outra instância, a aplicação deverá recuperar ou informar a situação conforme as regras do backend.

---

# 15. Validações e Tratamento de Erros

A implementação deverá contemplar situações excepcionais.

## 15.1. Configuração inválida

Impedir:

- Durações negativas.
- Durações nulas quando não permitidas.
- Quantidades inválidas de ciclos.
- Métodos sem configuração obrigatória.
- Valores incompatíveis com os limites definidos.

Apresentar mensagens claras e próximas dos campos correspondentes.

## 15.2. Falha de persistência

Se ocorrer falha ao salvar uma sessão:

- Não apresentar falsamente uma confirmação de salvamento.
- Preservar os dados disponíveis localmente.
- Informar o usuário quando necessário.
- Permitir nova tentativa.
- Evitar duplicação de registros.

## 15.3. Perda de conexão

A aplicação deverá preservar a continuidade local do temporizador.

Quando a conexão retornar, deverá sincronizar os eventos pendentes de acordo com a estratégia de persistência.

## 15.4. Falhas de áudio

Se um arquivo de áudio não puder ser reproduzido:

- Apresentar feedback discreto.
- Não interromper a sessão.
- Permitir tentar novamente.
- Manter os controles disponíveis.

## 15.5. Fullscreen

Se a API de fullscreen não estiver disponível ou houver erro:

- Preservar o funcionamento do temporizador.
- Não interromper a sessão.
- Informar a limitação quando relevante.

---

# 16. Acessibilidade e Usabilidade

A experiência deverá contemplar:

- Navegação por teclado.
- Indicadores de foco visíveis.
- Botões com nomes acessíveis.
- Contraste adequado.
- Estados que não dependam exclusivamente de cores.
- Áreas de interação apropriadas.
- Suporte a movimento reduzido.
- Controles acessíveis no Floating Timer.
- Comportamento adequado em diferentes escalas de tela.

A movimentação do widget deverá possuir uma alternativa acessível, permitindo reposicionamento por controles ou teclado quando possível.

---

# 17. Performance

A implementação deverá priorizar desempenho e estabilidade.

Diretrizes:

- Evitar renderizações desnecessárias da página inteira a cada atualização do temporizador.
- Isolar atualizações visuais do relógio.
- Evitar listeners duplicados.
- Limpar listeners e recursos ao desmontar componentes.
- Evitar intervalos concorrentes.
- Reutilizar componentes existentes.
- Utilizar carregamento sob demanda para áreas que não estejam visíveis, quando adequado.
- Evitar bibliotecas adicionais quando a infraestrutura atual já oferecer os recursos necessários.

As animações deverão utilizar propriedades apropriadas para renderização eficiente, evitando alterações frequentes de propriedades que provoquem recálculo de layout.

---

# 18. Regras de Negócio Fundamentais

As seguintes regras deverão ser respeitadas em toda a aplicação:

1. Deve existir apenas uma sessão ativa por usuário, conforme a regra de concorrência estabelecida.
2. A sessão possui uma única fonte de verdade.
3. O Floating Timer nunca controla uma contagem independente.
4. A navegação entre páginas não interrompe automaticamente uma sessão.
5. O fullscreen não pode ocultar ou destruir o temporizador.
6. Pausas não devem ser contabilizadas como tempo de concentração.
7. Sessões canceladas não devem ser contabilizadas como concluídas.
8. Métodos personalizados devem permanecer disponíveis após a navegação.
9. Excluir um método não deve apagar registros históricos.
10. O vínculo com curso e aula deve ser opcional.
11. Quando iniciada a partir de uma aula, a sessão deve herdar seu contexto.
12. As estatísticas devem utilizar dados persistidos e critérios consistentes.
13. A contagem do tempo deve utilizar timestamps, não depender da precisão de intervalos visuais.
14. O som ambiente não deve controlar nem interromper o estado da sessão.
15. A interface deverá refletir o estado real do mecanismo de temporização.

---

# 19. Etapas de Implementação

A implementação deverá ocorrer em etapas para reduzir riscos e permitir validação incremental.

## Etapa 1 — Auditoria

Antes de modificar o código:

- Identificar a implementação atual da página Foco.
- Identificar o temporizador existente.
- Identificar métodos e regras já implementados.
- Identificar a persistência.
- Identificar os componentes globais.
- Identificar o player e sua implementação fullscreen.
- Identificar a implementação de áudio.
- Mapear as dependências.
- Identificar funcionalidades que precisam ser preservadas.

Não substituir funcionalidades existentes sem compreender suas responsabilidades.

## Etapa 2 — Reestruturação visual

Implementar:

- Novo cabeçalho.
- Navegação secundária.
- Aba Temporizador.
- Aba Estatísticas.
- Aba Histórico.
- Aba Som ambiente.

Garantir consistência com o Design System.

## Etapa 3 — Refatoração do mecanismo de sessões

Implementar ou adaptar:

- Estado compartilhado.
- TimerController.
- CycleManager.
- Persistência.
- Recuperação.
- Transições de estado.

Garantir que a lógica não dependa dos componentes visuais.

## Etapa 4 — Floating Timer

Implementar:

- Widget compacto.
- Widget expandido.
- Movimentação.
- Encaixe nas bordas.
- Persistência de posição.
- Animações.
- Estados visuais.

## Etapa 5 — Integração com fullscreen

Integrar o widget à árvore de elementos fullscreen do player.

Testar entrada e saída de fullscreen, movimentação, expansão e controles.

## Etapa 6 — Estatísticas e histórico

Integrar dados reais.

Implementar gráficos, filtros, agrupamentos e detalhes.

## Etapa 7 — Som ambiente

Integrar catálogo, controles, volume, favoritos e persistência de reprodução.

## Etapa 8 — Testes e refinamento

Executar testes funcionais, visuais e de integração.

Verificar responsividade, acessibilidade, performance e ausência de regressões.

---

# 20. Critérios de Aceitação

A reformulação será considerada concluída quando os seguintes requisitos forem atendidos.

## Página Foco

- [ ] A página possui somente as quatro áreas funcionais definidas.
- [ ] A navegação secundária funciona corretamente.
- [ ] O layout segue o Design System existente.
- [ ] A página está responsiva.
- [ ] Não existem elementos visuais sobrepostos ou desalinhados.
- [ ] Não existem funcionalidades fora do escopo.

## Temporizador

- [ ] Os métodos padrão funcionam.
- [ ] Métodos personalizados podem ser criados.
- [ ] Configurações são validadas.
- [ ] Ciclos e pausas funcionam corretamente.
- [ ] Pausar e retomar preservam o tempo.
- [ ] O encerramento registra o estado correto.
- [ ] O cronômetro livre funciona.

## Floating Timer

- [ ] Aparece automaticamente ao iniciar uma sessão.
- [ ] Possui estado compacto.
- [ ] Possui estado expandido.
- [ ] Pode ser minimizado.
- [ ] Pode ser movimentado.
- [ ] Respeita os limites da viewport.
- [ ] Preserva sua posição.
- [ ] Possui transições suaves.
- [ ] Permanece visível durante fullscreen.
- [ ] Não interfere nos controles do player.
- [ ] Permanece sincronizado com a página Foco.

## Estatísticas

- [ ] Os indicadores utilizam dados reais.
- [ ] Os gráficos respeitam os filtros.
- [ ] O mapa de consistência apresenta os dias corretamente.
- [ ] Pausas não são contabilizadas como concentração.
- [ ] Estados vazios são tratados.

## Histórico

- [ ] As sessões são agrupadas por data.
- [ ] Os filtros funcionam.
- [ ] Os detalhes são exibidos corretamente.
- [ ] Sessões canceladas e interrompidas são diferenciadas.
- [ ] Registros anteriores permanecem preservados.

## Som ambiente

- [ ] Os controles de áudio funcionam.
- [ ] O volume pode ser ajustado.
- [ ] A reprodução não é interrompida por navegação entre páginas.
- [ ] Os erros de reprodução são tratados.
- [ ] A integração com as sessões funciona.

## Qualidade técnica

- [ ] Não existem temporizadores concorrentes.
- [ ] A sessão possui uma única fonte de verdade.
- [ ] A recuperação após atualização funciona.
- [ ] A persistência é consistente.
- [ ] Não existem listeners duplicados.
- [ ] Não existem erros relevantes no console.
- [ ] A implementação não introduz regressões em outras páginas.

---

# 21. Orientações Finais para Implementação

Este documento estabelece o planejamento funcional e visual da nova página Foco, mas não autoriza alterações arbitrárias na arquitetura geral do Teleclass.

Antes de iniciar, o desenvolvedor ou agente de programação deverá analisar a implementação atual, identificar estruturas reutilizáveis e compreender os contratos existentes.

Não criar componentes duplicados quando já houver soluções compartilhadas adequadas.

Não inventar endpoints, contratos de API, campos de banco de dados ou comportamentos que não estejam implementados.

Quando uma funcionalidade depender de suporte inexistente no backend, documentar a limitação e propor a integração necessária, sem simular persistência definitiva.

O Design System existente é a fonte de verdade visual. Todas as novas telas e componentes deverão utilizar suas cores, tipografia, espaçamentos, arredondamentos, estados e convenções.

A prioridade é alcançar uma experiência visualmente sofisticada, tecnicamente consistente, responsiva e confiável.

**O resultado esperado é um ambiente de concentração integrado ao Teleclass, no qual a página Foco funciona como central de gerenciamento e o Floating Timer acompanha o usuário de maneira discreta, elegante e persistente durante toda a experiência de aprendizagem.**