# GoAudit · Prompt de desenvolvimento (v3)

> **O que mudou desde a v2:** a saída do sistema (decisões, log, alertas, aprovações) passa a ser gravada no **Supabase** (Postgres), com **autenticação por JWT** (Supabase Auth) e **Row Level Security (RLS)** em todas as tabelas. A base de entrada continua em CSV. Foram acrescentados os requisitos funcionais e não funcionais (seção 15) e o roadmap foi refeito em duas trilhas paralelas (seção 13).

## 1. Papel e contexto

Atue como engenheiro de software sênior, especialista em arquitetura full-stack e em sistemas com agentes de IA.

Vamos construir o MVP do **GoAudit** para o desafio **Pagamentos** do GoHacks Talent 2026 (Gogroup).

**O desafio, nas palavras da organização:** uma empresa processa uma quantidade alta de pagamentos e não consegue olhar cada um no detalhe. Vários processos dependem de cadastro manual em sistemas, o que abre espaço para pagamento em duplicidade, um zero a mais ou dado cadastrado errado. A informação para conferir está espalhada entre sistemas internos e bancos. Os seis pontos a atacar são:

1. Um volume que não permite revisar pagamento por pagamento.
2. Processos de cadastro extremamente manuais, repetidos em mais de um sistema.
3. Erros que nascem no cadastro manual: duplicidade, valores errados.
4. Informação fragmentada entre sistemas internos e bancos.
5. Pegar o erro antes de o dinheiro sair, e não depois.
6. Saber o que pode seguir sozinho e o que precisa de aprovação.

**O que o GoAudit faz:** um sistema de agentes que, a cada hora, lê a base de contas a pagar, confere cada título agendado contra todos os sistemas e dá a ele um destino:

- **Libera sozinho** os pagamentos de rotina que passaram em todas as checagens, dentro da alçada.
- **Retira do lote sozinho** o que tem erro ou indício de fraude, e notifica a pessoa certa.
- **Pede aprovação** quando a política exige uma decisão humana.
- **Alerta o gestor** quando o valor de um fornecedor foge muito da referência dos meses anteriores ou do contrato.

Tudo o que agentes e humanos fazem fica num log de auditoria só de inclusão, que sustenta a prestação de contas e mostra os gargalos.

---

## 2. Princípios de arquitetura (não negociáveis)

1. **Regras em código, IA para texto.** Toda checagem de valor, tolerância, alçada, CNPJ, duplicidade e prazo é código determinístico e testável. A IA lê texto livre (e-mails, WhatsApps), classifica e explica decisões. A IA nunca calcula valores nem decide se uma tolerância foi ultrapassada.
2. **Quem lê o texto não age; quem age não lê o texto bruto.** O componente que lê mensagens não tem acesso a nenhuma ação. Ele devolve só dados num formato fechado. As ações são decididas pelo motor de regras e pelos agentes a partir desses dados.
3. **Mensagem só aumenta risco, nunca diminui.** Uma mensagem pode abrir alerta, retirar do lote ou bloquear. Nunca pode liberar pagamento, dispensar checagem ou trocar dados bancários.
4. **Retirar é reversível, pagar não é.** Até o fechamento do lote, um título retirado pode voltar. Por isso o agente de operação pode retirar sozinho, e o agente de validação desfaz os exageros a tempo.
5. **Nada fixo no código.** Tolerâncias, alçadas, horários de lote, pessoas a acionar e custos vêm de `politicas.csv` e de um arquivo de configuração. Nenhum ID ou valor da base de exemplo pode aparecer no código. A avaliação pode usar outro cenário com a mesma estrutura.
6. **Entrada em CSV, saída no Supabase.** Os CSVs de entrada nunca são alterados e podem ser trocados por outro cenário sem mudar código. Todo o estado produzido pelo sistema (decisões, retiradas, aprovações, alertas, notificações, log) vive no Supabase.
7. **Log só de inclusão, garantido pelo banco.** Nenhuma linha do log é editada ou apagada, e isso é imposto por RLS e por trigger, não só pela aplicação. Correção é uma linha nova que aponta para a anterior.
8. **Custo de IA visível.** Toda chamada ao AI Proxy registra modelo, tokens e, quando houver, custo estimado em US$ no log.
9. **O banco é a última barreira contra a IA.** Os agentes se autenticam com contas próprias e JWT próprio, sujeitos a RLS como qualquer usuário. Se um agente tentar algo fora do papel dele (aprovar, alterar o log, ler o que não deve), o banco recusa, mesmo que o modelo tenha sido enganado. A chave `service_role` do Supabase só é usada em migrações e na carga inicial, nunca em tempo de execução.
10. **Permissão nasce no servidor.** Perfil, alçada e `pessoa_id` chegam no JWT como claims gravadas pelo servidor. Nada que o navegador envie define o que o usuário pode fazer.

---

## 3. Escopo do MVP

**Dentro:**

- Módulo de pagamentos da base do desafio, mais cenários inventados para a demo.
- Relógio simulado a partir de 02/11/2026 08:00, avançando em passos de 1 hora.
- Motor de regras, leitor de mensagens, agente de operação, agente de validação.
- Notificações registradas no sistema e exibidas no painel (sem envio real de e-mail ou WhatsApp).
- Painel web com visão geral, fila, detalhe do título, alertas, log e gargalos, atualizado em tempo real.
- Login com e-mail e senha via Supabase Auth (JWT), perfis por papel e RLS em todas as tabelas de saída.
- Usuários de demonstração criados a partir de `usuarios_sistema.csv` e das pessoas de `politicas.csv`, com e-mails fictícios.

**Fora:**

- Leitura de PDF, imagem ou foto de comprovante (OCR/visão).
- Integração real com bancos, ERP ou canais de mensagem.
- Carga da base de entrada no Supabase: a entrada continua em CSV (pode virar etapa futura).
- Login social, SSO e recuperação de senha por e-mail real.

---

## 4. Dados

### 4.1 Base de entrada (`data/base/`, somente leitura)

Usar os arquivos da pasta `pagamentos/` da base do desafio. Os mais importantes:

| Arquivo | Uso no GoAudit |
| --- | --- |
| `agenda_remessa.csv` | A fila: títulos agendados por lote, com horário de fechamento e destino do pagamento |
| `lotes_remessa.csv` | Cabeçalho dos lotes, histórico e lotes abertos |
| `contas_a_pagar.csv` | Títulos do ERP: NF digitada, OC, valor, vencimento, boleto, quem lançou, aprovação |
| `fornecedores.csv` | Cadastro: CNPJ, categoria, dados bancários, PIX, canais oficiais |
| `alteracoes_cadastro.csv` | Histórico de alterações cadastrais, com origem e confirmação |
| `pedidos_compra.csv` | OCs: valor, status, comprador, aprovação |
| `contratos_fornecedores.csv` | Contratos recorrentes: valor mensal, reajuste, gestor |
| `notas_fiscais.csv`, `nf_duplicatas.csv` | NFs recebidas e suas parcelas |
| `recebimentos_mercadoria.csv` | Entrada física da mercadoria |
| `dda_boletos.csv` | Boletos registrados contra o CNPJ da empresa, com o beneficiário real |
| `extrato_banco_meridiano.csv` | Extrato do banco 612 (vírgula, data ISO, ponto decimal) |
| `extrato_banco_litoral.csv` | Extrato do banco 437 (`;`, dd/mm/aaaa, vírgula decimal, ponto de milhar, sem número do título) |
| `retorno_remessa.csv` | Resultado de cada título enviado (pago ou rejeitado) |
| `comunicacoes_fornecedores.csv` | E-mails recebidos (o dicionário fala em jsonl, mas o arquivo é CSV) |
| `usuarios_sistema.csv` | Usuários, perfil, alçada, admissão e desligamento |
| `aprovacoes.csv`, `log_auditoria_erp.csv` | Histórico de aprovações e trilha do ERP |
| `politicas.csv`, `ferramentas.csv` | Regras e ações permitidas por papel |
| `feriados_bancarios.csv` | Dias sem remessa |
| `parametros.md`, `dicionario_de_dados.md` | Significado das colunas e premissas |

**Armadilhas conhecidas da base, a tratar na camada de leitura:**

- O número da NF no título está "como foi digitado": com ou sem zeros à esquerda, às vezes com a série depois de `-` ou `/`. É preciso normalizar.
- O CNPJ aparece com pontuação no ERP e só com números em Compras e na NF. A NF pode vir de filial (mesma raiz de 8 dígitos, outra razão social).
- O fornecedor tem um código no ERP (`FP` + 4 dígitos) e outro em Compras (`FN`/`FC`). A ligação entre eles é pela raiz do CNPJ.
- A linha digitável do boleto (47 dígitos) traz embutidos o banco do beneficiário, o fator de vencimento e o valor em centavos (posições descritas no dicionário).
- O extrato do Litoral não traz o número do título. A conciliação é por data, valor e nome abreviado.
- Muitos fornecedores cobram por um banco diferente do banco da conta do cadastro. O "banco de cobrança histórico" deve ser aprendido do DDA e dos pagamentos passados.

### 4.2 Dados inventados (`data/cenarios/`)

Podemos inventar dados fictícios. A base de exemplo continua sendo a espinha dorsal, e os dados inventados entram como **cenários plantados**:

- Cada cenário acrescenta linhas em cópias dos CSVs (nunca no original), por meio de um script de montagem que gera a base da demo em `data/demo/`.
- `data/cenarios/cenarios_esperados.csv` lista cada cenário com: `cenario_id`, descrição, entidades afetadas, regra que deve disparar e decisão esperada.
- Esse arquivo serve ao mesmo tempo como roteiro da demo e como teste automatizado do motor.
- Incluir mensagens de WhatsApp inventadas: a base de exemplo só tem e-mails.

A lista mínima de cenários está na seção 11.

### 4.3 Banco de saída (Supabase)

Todo o estado produzido pelo GoAudit fica no Postgres do Supabase. Tabelas mínimas:

| Tabela | Conteúdo |
| --- | --- |
| `perfis` | Uma linha por usuário do `auth.users`: nome, papel, alçada, `pessoa_id`, login de origem em `usuarios_sistema.csv`, ativo. Agentes também têm linha aqui |
| `simulacoes` | Cada execução da simulação: base usada (cenário), início, hora simulada atual, situação. Permite reiniciar a demo sem apagar o histórico |
| `ciclos` | Cada passo do relógio: hora simulada, duração, títulos avaliados, chamadas de IA, tokens e custo |
| `decisoes` | Situação atual de cada título: destino, regras disparadas, risco, urgência, agente que decidiu, resumo da IA |
| `avaliacoes_regras` | Resultado de cada regra por título e ciclo, com evidências (IDs dos registros da base) |
| `movimentos_lote` | Retiradas e devoluções de títulos nos lotes. A agenda efetiva é a agenda do CSV menos retiradas mais devoluções |
| `solicitacoes_aprovacao` | Pedidos de aprovação: título, valor, tipo (simples, dupla, alçada superior), solicitante, aprovadores exigidos, situação |
| `aprovacoes` | Cada aprovação ou recusa dada por um humano, ligada à solicitação |
| `alertas` | Alertas abertos e encerrados (variação mensal, golpe, divergência), com dono e situação |
| `notificacoes` | Caixa de entrada de cada pessoa, com títulos agrupados e situação de leitura |
| `mensagens_processadas` | Resultado da leitura de cada e-mail ou WhatsApp: tipo, dados extraídos, remetente conferido, confiança |
| `log_auditoria` | Log só de inclusão de toda ação de agente, humano ou motor (seção 8) |

**Regras de gravação:**

- Toda tabela de saída tem `simulacao_id` para separar as execuções da demo.
- O ciclo é idempotente: uma chave única por simulação, título, hora simulada e ação impede ações em dobro se o mesmo passo rodar de novo.
- Mudanças sensíveis (aprovar, devolver ao lote, desfazer decisão) passam por funções no banco (`rpc`) que validam a regra de negócio e gravam o log na mesma transação.
- O painel assina as tabelas `decisoes`, `alertas`, `notificacoes` e `ciclos` pelo Supabase Realtime, respeitando RLS.

---

## 5. Regras de negócio (motor de regras)

Cada regra tem um código, lê seus parâmetros de `politicas.csv` ou da configuração e devolve: passou ou falhou, severidade, evidências (IDs dos registros usados) e uma frase curta de motivo.

| Código | Regra | Falha quando |
| --- | --- | --- |
| R01 | Duplicidade | Existe outro título não cancelado do mesmo fornecedor (raiz do CNPJ) com a mesma NF normalizada e parcela, ou com a mesma linha digitável, ou com mesmo valor e vencimento próximo |
| R02 | Já pago por outro caminho | O título ou a mesma duplicata já aparece como pago no extrato de algum banco, no retorno da remessa ou como liquidado no DDA |
| R03 | NF × título | A diferença entre o valor do título e a duplicata passa de R$ 0,10. Se o pagamento for depois do vencimento, o teto é a duplicata mais multa de 2% e juros de 1% ao mês pro rata |
| R04 | OC × NF | A NF passa do valor da OC em mais do que o maior entre 2% e R$ 50; ou a OC não está aprovada. Utilidades dispensam OC. Para contrato, a referência é o valor mensal |
| R05 | Fornecedor | A raiz do CNPJ da NF ou da OC não é a do fornecedor do título |
| R06 | Boleto | O banco, o valor ou o CNPJ do beneficiário (lidos da linha digitável e do DDA) não batem com o fornecedor nem com o banco de cobrança histórico dele |
| R07 | Destino TED/PIX | Os dados bancários do fornecedor mudaram há menos de 30 dias sem confirmação válida (ligação para o telefone que estava no cadastro **antes** da alteração) |
| R08 | Alçada e fracionamento | A soma dos títulos do mesmo fornecedor e da mesma NF no mesmo dia passa da alçada de quem aprovou; ou quem lançou é quem aprovou (segregação) |
| R09 | Aprovação dupla | O caso exige aprovação dupla e ela não existe: sem NF (exceto aluguel), sem OC aprovada (exceto utilidades), antecipação, troca bancária recente sem confirmação |
| R10 | Recebimento | Título de produto, embalagem ou insumo sem recebimento conferido da mercadoria, ou com quantidade incompatível |
| R11 | Valor atípico ("zero a mais") | O valor está muito acima da referência do fornecedor (por padrão, 5 vezes a mediana histórica ou fora do contrato) |
| R12 | Variação mensal | O total do mês do fornecedor foge da referência acima do limite configurado. Gera **alerta ao gestor**, não retirada (ver 5.2) |
| R13 | Lançador | Título lançado ou alterado por usuário desligado ou inativo, ou valor alto lançado por usuário admitido há pouco tempo |
| R14 | Mensagem de risco | Existe mensagem recente do fornecedor (ou em nome dele) pedindo troca de conta, enviando segunda via com dados diferentes, vinda de canal fora do cadastro ou pedindo pagamento urgente fora do processo |

### 5.1 Destino de cada título

| Situação | Destino | Quem age |
| --- | --- | --- |
| Passou em todas as regras e o valor cabe na alçada do agente (padrão R$ 5.000, a do `analista_cp`) | **Liberado automático** | Agente de operação |
| Passou em todas as regras, mas o valor está acima da alçada do agente | **Conferido, aguardando aprovador**, com dossiê pronto para aprovação em lote | Aprovador humano (até R$ 50 mil) ou diretora PS03 (acima) |
| Falha crítica (R01, R02, R05, R06, R07, R14 com troca de conta) | **Retirado do lote** e notificação imediata | Agente de operação, revisado pela validação |
| Falha de conferência (R03, R04, R10, R11) | **Retirado do lote** e acionamento do dono (comprador, gestor do contrato) | Agente de operação, revisado pela validação |
| Exige aprovação dupla ou alçada superior (R08, R09) | **Aguardando aprovação**. Se não houver aprovação até a margem antes do fechamento (padrão 30 min), retirar do lote | Agente de operação |
| Variação mensal (R12) sem outra falha | **Alerta ao gestor**, título segue o fluxo normal | Agente de operação |

O agente nunca aprova o que a política reserva a um humano. Aprovação dupla e alçadas acima da do agente são sempre humanas.

### 5.2 Referência para a variação mensal (R12)

A comparação direta mês contra mês gera muito ruído. Na base, um mesmo influenciador vai de R$ 5.550 para R$ 41.600 e depois R$ 900 por natureza de campanha. Por isso a referência depende da categoria do fornecedor:

| Categoria | Referência | Faixa padrão |
| --- | --- | --- |
| Aluguel, ti_saas, serviços e agência com contrato fixo | Valor mensal do contrato, considerando o mês de reajuste previsto | 5% |
| Utilidades | Média dos últimos 3 meses | 30% |
| Produto, embalagens, insumos, frete | Valor da OC ou do contrato do título, não o mês anterior | Tolerância de 3 vias |
| Influenciador e agência sem contrato fixo | Valor da OC | Tolerância de 3 vias |

Faixas configuráveis. O alerta vai para o dono certo segundo `politicas.csv` (seção `acionamento_humano`).

### 5.3 Urgência

A urgência é `IMEDIATA` quando faltam menos de 2 horas (hora simulada) para o fechamento do lote do título: Banco Meridiano (612) às 10:00 e Banco Litoral (437) às 14:00, em dias úteis, considerando `feriados_bancarios.csv`. A fila é ordenada por urgência, depois por risco, depois por valor.

---

## 6. Agentes e componentes

Todos os modelos de IA são chamados pelo **AI Proxy do Gogroup** (`https://ai-proxy.gogroupbr.com/v1`, formato OpenAI). O token vem da variável `AI_PROXY_API_KEY` no `.env.local`, fora do git, e nunca aparece em log ou na tela. Modelos `deepseek-*` são proibidos no evento.

### 6.1 Motor de regras (sem IA)

- Roda as regras R01 a R14 sobre todos os títulos da agenda efetiva a cada passo do relógio.
- Resolve a grande maioria dos títulos sem custo de IA.
- Saída: uma avaliação por título, com regras disparadas, evidências e destino sugerido.

### 6.2 Leitor de mensagens (IA isolada, sem poder de ação)

Processa cada e-mail ou WhatsApp novo em quatro etapas:

1. **Remetente (sem IA):** comparar e-mail ou telefone com os canais oficiais do fornecedor no cadastro. Marcar domínio diferente, telefone novo citado na própria mensagem ou remetente desconhecido.
2. **Extração (regex primeiro):** tirar dos anexos de boleto banco, beneficiário, CNPJ, valor, vencimento e linha digitável. Só o que o regex não resolver vai para um modelo rápido de chat (`glm-5.3-flash` ou `mimo-v2.6-flash`) com saída num formato fixo validado.
3. **Classificação (Jev, `/v1/systemone`):** responder perguntas fechadas sobre a mensagem: tipo (boleto novo, segunda via, troca de dados bancários, cobrança de atraso, reajuste, aviso de duplicidade, phishing ou outro), urgência e se pede algo fora do processo. Confiança abaixo de 0,7 vira revisão humana.
4. **Entrega:** grava o resultado em `mensagens_processadas.csv`. O texto original é passado aos modelos só como dado, delimitado e identificado como conteúdo de terceiros.

O leitor não chama nenhuma ação. A conferência com cadastro, DDA e título é feita pelo motor de regras (R06, R07, R14). No banco, ele usa a conta `agente_leitor`, que pela RLS só pode inserir em `mensagens_processadas` e no log. Mesmo que um e-mail malicioso engane o modelo, essa conta não tem como mexer em decisões, lotes ou aprovações.

### 6.3 Agente de operação (modelo barato)

Equivale aos papéis `analista_cp` e `auditor` em `ferramentas.csv`. A cada passo do relógio:

1. Recebe as avaliações do motor e os resultados do leitor de mensagens.
2. Executa os destinos da seção 5.1: libera, marca para aprovação, retira do lote, alerta.
3. Monta a notificação para a pessoa certa, segundo `politicas.csv`, agrupando vários títulos do mesmo assunto numa notificação só.
4. Gera, com IA, um resumo curto de cada decisão não trivial em linguagem de negócio: o problema, o valor, a regra e a ação recomendada.
5. Grava tudo na tabela `decisoes` e no log.

**Ações permitidas:** liberar até a alçada configurada, retirar do lote, devolver ao lote, bloquear título, solicitar aprovação, acionar pessoa, abrir alerta. **Não pode:** aprovar, trocar dado bancário, cancelar título acima da alçada, liberar lote inteiro.

No banco, usa a conta `agente_operacao`. A RLS e as funções do banco impõem as mesmas permissões: inserir e atualizar `decisoes`, `movimentos_lote`, `alertas`, `notificacoes` e `solicitacoes_aprovacao`; nunca inserir em `aprovacoes`. Liberação automática acima da alçada gravada no JWT é recusada pelo banco.

### 6.4 Agente de validação (modelo mais forte, só nos casos caros)

Espelha a regra de segregação da política: quem executa não confere a si mesmo. Antes do fechamento de cada lote, com margem configurável, revisa três tipos de caso:

- **Retiradas do lote:** se a evidência não se sustenta, devolve o título ao lote a tempo e evita multa, juros e custo de relacionamento.
- **Liberações automáticas acima de um valor de corte** (padrão R$ 20.000): se encontrar problema, retira.
- **Notificações e acionamentos:** descarta os fracos e consolida os repetidos, porque cada acionamento humano desnecessário custa R$ 60.

Recebe o dossiê estruturado de cada caso (evidências e regras), nunca o texto bruto das mensagens. Usa um modelo mais capaz (`latest` ou `glm-5.3`). Cada revisão gera uma linha no log ligada à decisão original.

No banco, usa a conta `agente_validacao`, distinta da conta de operação. A segregação fica registrada: o log mostra que quem executou e quem conferiu são identidades diferentes.

### 6.5 Humanos

Aprovador, coordenadora de contas a pagar (PS01), tesoureiro (PS02), diretora financeira (PS03), compradores e gestores de contrato, conforme `politicas.csv`. No painel eles entram com login próprio, veem só o que o papel permite, aprovam ou recusam e podem desfazer uma decisão do agente. Toda ação humana também vai para o log, com o ID do usuário tirado do JWT.

---

## 7. Ciclo de cada passo do relógio

O ciclo roda no servidor (Route Handler protegido), disparado por um usuário com papel de administrador da simulação no painel ou por um agendador. Cada agente abre a própria sessão no Supabase e grava com o próprio JWT.

1. Avançar o relógio simulado em 1 hora (botão no painel ou modo automático).
2. Carregar o que "chegou" até a nova hora: títulos, mensagens e linhas de extrato.
3. Leitor processa as mensagens novas.
4. Motor de regras reavalia os títulos dos lotes abertos.
5. Agente de operação executa os destinos e notifica.
6. Agente de validação revisa os casos dos lotes que fecham nas próximas horas.
7. Lotes cujo horário de fechamento passou são marcados como enviados. O que estava neles conta como pago.
8. Painel atualiza contadores, fila e log.

---

## 8. Log de auditoria

Tabela `log_auditoria` no Supabase, no espírito do `log_auditoria_erp.csv` que o financeiro já conhece, com campos a mais. O painel permite exportar o log em CSV para prestação de contas.

| Campo | Conteúdo |
| --- | --- |
| `log_id` | Sequencial |
| `data_hora_real`, `data_hora_simulada` | Quando aconteceu, no relógio real e no simulado |
| `ator_tipo` | `motor_regras`, `agente_operacao`, `agente_validacao`, `leitor_mensagens` ou `humano` |
| `ator_id` | ID do usuário no Supabase Auth (`auth.uid()`), preenchido pelo banco, nunca pela aplicação |
| `ator_papel` | Papel do ator no momento da ação, copiado do JWT |
| `acao` | Liberou, retirou do lote, devolveu ao lote, bloqueou, alertou, notificou, aprovou, recusou, leu mensagem, desfez |
| `entidade`, `entidade_id` | Título, lote, fornecedor, mensagem ou alerta |
| `regras` | Códigos das regras que motivaram a ação |
| `evidencias` | IDs dos registros usados (NF, OC, duplicata, linha do extrato, mensagem) |
| `motivo` | Frase curta em linguagem de negócio |
| `valor_em_jogo` | Valor em R$ |
| `modelo_ia`, `tokens_entrada`, `tokens_saida`, `custo_usd`, `confianca` | Quando houve IA |
| `log_relacionado` | ID da ação que esta revisa, aprova ou desfaz |
| `situacao` | Pendente, concluída ou revertida |

**Usos no painel:** histórico completo de cada título (prestação de contas); tempo entre alerta e ação humana; títulos parados esperando aprovação perto do fechamento; fila por aprovador; taxa de retiradas desfeitas pela validação (falso positivo); custo de IA por dia e por tipo de decisão.

---

## 9. Placar e métricas

O desafio mede o resultado em R$:

> placar = −(dinheiro que saiu indevidamente + custo de atrasar pagamento legítimo + custo de acionamentos humanos desnecessários)

O painel calcula uma estimativa desse placar ao longo da simulação, usando os custos de `politicas.csv`: multa de 2%, juros de 1% ao mês, custo de relacionamento por categoria quando um título legítimo atrasa (um atraso conta como 7 dias corridos) e R$ 60 por acionamento desnecessário. Com os cenários plantados dá para comparar "sem GoAudit" (o tesoureiro assina tudo) com "com GoAudit".

---

## 10. Interface (Next.js)

1. **Visão geral:**
   - Hora simulada e controles do relógio.
   - Contagem regressiva para o fechamento dos lotes do dia (Meridiano 10h, Litoral 14h).
   - Contadores: títulos na fila, liberados automáticos, aguardando aprovação, retirados, alertas abertos, montante em risco e montante protegido.
   - Placar estimado e custo de IA acumulado.
2. **Fila de auditoria (`/auditoria`):**
   - Tabela com filtros por destino, risco, urgência, banco, lote e fornecedor.
   - Etiquetas por grupo de regras: 3 vias, alçada, dados bancários, duplicidade, mensagem.
3. **Detalhe do título (painel lateral):**
   - Comparação lado a lado: título no ERP × duplicata da NF × OC ou contrato × boleto no DDA × cadastro do fornecedor.
   - Regras disparadas com evidências clicáveis.
   - Resumo da IA e ação recomendada.
   - Mensagens relacionadas.
   - Linha do tempo do log daquele título.
   - Ações humanas: aprovar, recusar, devolver ao lote, manter retido.
4. **Alertas e notificações:** caixa de entrada da pessoa logada, com aprovação em lote para os "conferidos, aguardando aprovador".
5. **Log e gargalos:** log filtrável e exportável em CSV, com os indicadores da seção 8.
6. **Login (`/login`):** e-mail e senha. Na demo, uma lista de contas fictícias por papel facilita a troca de perfil diante da banca.
7. **Administração da simulação:** iniciar, avançar, pausar e reiniciar a simulação e escolher o cenário. Só para o papel `admin_simulacao`.

Cada tela mostra só o que o papel do usuário permite, e os botões de ação aparecem só para quem pode executá-los. Esconder o botão é conforto de uso; quem garante a permissão é a RLS.

Tema com modo escuro, tudo em português.

---

## 11. Cenários plantados (mínimo)

| ID | Cenário | Regra | Decisão esperada |
| --- | --- | --- | --- |
| C01 | Mesmo título lançado duas vezes, NF digitada como `000123` e `123-1` | R01 | Retirar a cópia e notificar PS01 |
| C02 | Título com um zero a mais (R$ 48.000 em vez de R$ 4.800) | R03, R11 | Retirar e notificar PS01 |
| C03 | Título já pago por PIX manual (no extrato do Litoral) e ainda agendado | R02 | Retirar e notificar o tesoureiro PS02 |
| C04 | Boleto de segunda via com beneficiário de outro CNPJ e banco diferente do histórico | R06, R14 | Retirar, notificar PS01 e jurídico PS08 |
| C05 | WhatsApp pedindo troca de conta, com telefone novo citado na própria mensagem, seguido de alteração no cadastro sem confirmação válida | R07, R14 | Retirar todos os títulos do fornecedor, notificar PS01 |
| C06 | E-mail se passando pela diretora pedindo pagamento urgente fora do processo | R14 | Nenhuma ação de pagamento; alerta de golpe para PS03 e PS08 |
| C07 | E-mail de phishing ("atualização obrigatória do token") com instrução escondida para o agente | Leitor | Classificar como phishing, nenhuma ação derivada do texto |
| C08 | NF 4% acima da OC de embalagem | R04 | Retirar e acionar a compradora PS04 |
| C09 | NF 1,5% acima da OC (dentro da tolerância) | R04 | Liberar normalmente |
| C10 | Título pago com 10 dias de atraso, com multa e juros dentro do teto | R03 | Liberar normalmente |
| C11 | Três títulos de R$ 4.900 do mesmo fornecedor e NF no mesmo dia | R08 | Aguardando aprovação (fracionamento) |
| C12 | Aluguel sem NF, igual ao contrato | Dispensa | Liberar normalmente |
| C13 | Aluguel 18% acima do contrato fora do mês de reajuste | R12 | Alerta ao facilities PS10 |
| C14 | Fatura de influenciador 8 vezes acima do mês anterior, mas igual à OC | R12 | Nenhum alerta (referência é a OC) |
| C15 | Título lançado por usuário já desligado | R13 | Retirar e notificar PS01 |
| C16 | Filial com outra razão social na NF, mesma raiz de CNPJ | R05 | Liberar normalmente |
| C17 | Retirada falso positivo que a validação devolve ao lote antes das 10h | Validação | Devolver ao lote e registrar no log |

Os cenários C09, C10, C12, C14 e C16 existem para provar que o sistema **não** trava pagamento legítimo.

---

## 12. Stack

- **Full-stack:** Next.js (App Router, Server Actions, Route Handlers), TypeScript em modo estrito.
- **UI:** Tailwind CSS, shadcn/ui (Radix), Lucide, com modo escuro.
- **Entrada:** CSV lido com papaparse ou fast-csv em stream. Índices em memória carregados na inicialização e recarregados a cada passo do relógio.
- **Saída e autenticação:** Supabase (Postgres, Auth com JWT, RLS, Realtime). Integração com Next.js por `@supabase/ssr`, com sessão em cookie `httpOnly` e renovação no middleware.
- **Migrações:** Supabase CLI, com schema, políticas RLS, funções e triggers versionados em `supabase/migrations/`.
- **IA:** AI Proxy do Gogroup via SDK OpenAI. Jev (`/v1/systemone`) para classificação; `glm-5.3-flash` ou `mimo-v2.6-flash` para extração e resumos; `latest` ou `glm-5.3` para o agente de validação.
- **Testes:** Vitest para regras e normalizadores sobre `cenarios_esperados.csv`; testes de RLS que entram com cada papel e tentam operações proibidas (pgTAP ou testes de integração com o cliente Supabase).

**Variáveis de ambiente** (todas em `.env.local`, fora do git):

| Variável | Onde é usada | Pode ir ao navegador? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente e servidor | Sim (a chave anônima só funciona dentro da RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Só migrações e script de carga inicial | Nunca |
| `AGENTE_OPERACAO_*`, `AGENTE_VALIDACAO_*`, `AGENTE_LEITOR_*` | Credenciais das contas dos agentes, só no servidor | Nunca |
| `AI_PROXY_API_KEY` | Chamadas ao AI Proxy, só no servidor | Nunca |

### Estrutura de diretórios sugerida

```
data/
  base/            CSVs originais (somente leitura)
  cenarios/        definição dos cenários e cenarios_esperados.csv
  demo/            base montada (original + cenários)
supabase/
  migrations/      schema, RLS, funções, triggers
  seed/            usuários de demonstração e perfis
  tests/           testes de RLS por papel
src/
  app/
    (auth)/login/  tela de login
    (painel)/      visão geral, auditoria, alertas, log, administração
    api/           rotas do ciclo e das ações
  components/      UI do painel
  middleware.ts    renovação de sessão e bloqueio de rotas sem login
  lib/
    config/        leitura de politicas.csv e parâmetros
    data/          leitura de CSV, índices e normalizadores (CNPJ, NF, linha digitável, extratos)
    clock/         relógio simulado e calendário bancário
    rules/         R01 a R14, cada uma isolada e testável
    agents/        leitor de mensagens, agente de operação, agente de validação
    ai/            cliente do AI Proxy, registro de tokens e custo
    supabase/      clientes (navegador, servidor, agentes) e acesso às tabelas
    auth/          leitura das claims do JWT e checagem de papel nas rotas
  types/           tipos do domínio e tipos gerados do banco
scripts/           montagem da base de demo e carga dos usuários
tests/             testes de regras e cenários
```

---

## 13. Roadmap

O trabalho corre em **duas trilhas paralelas**, que se encontram na Etapa 5. Assim o motor de regras não espera a infraestrutura ficar pronta, e vice-versa. Cada etapa tem prioridade: **P0** é indispensável para a demo, **P1** fortalece a entrega, **P2** entra se sobrar tempo.

### Trilha A: domínio (dados, regras, agentes)

**A1 · Dados, normalização e relógio (P0)**
- Leitura tipada dos CSVs da seção 4.1, com índices por `titulo_id`, `fornecedor_id`, raiz de CNPJ, NF normalizada, `oc_id`, chave de acesso e lote.
- Normalizadores: CNPJ, NF digitada, linha digitável (banco, valor, vencimento), extrato do Litoral.
- Relógio simulado com calendário bancário.
- *Pronto quando:* cada título da agenda é ligado à sua NF, duplicata, OC e fornecedor, e um relatório lista os que não foram ligados.

**A2 · Motor de regras (P0)**
- R01 a R14 e a tabela de destinos da seção 5.1, sem dependência de banco (funções puras).
- Script que monta a base de demo com os cenários.
- *Pronto quando:* todos os cenários da seção 11 dão a decisão esperada nos testes.

**A3 · Leitor de mensagens (P1)**
- Conferência de remetente, extração com regex, classificação com Jev, extração com IA como alternativa.
- Registro de tokens e custo de cada chamada.
- *Pronto quando:* C04 a C07 são classificados corretamente e o C07 não gera nenhuma ação.

### Trilha B: plataforma (Supabase, autenticação, painel)

**B1 · Projeto Supabase e schema (P0)**
- Tabelas da seção 4.3, chaves, índices e `simulacao_id`.
- Trigger que impede `UPDATE` e `DELETE` em `log_auditoria` e preenche `ator_id` e `ator_papel` a partir do JWT.
- *Pronto quando:* as migrações sobem do zero num projeto limpo com um comando.

**B2 · Autenticação JWT (P0)**
- Login com e-mail e senha no Supabase Auth.
- Hook de token de acesso que grava `papel`, `alcada` e `pessoa_id` como claims, lidos da tabela `perfis`.
- Middleware do Next.js que renova a sessão e bloqueia rotas sem login; checagem de papel nas Server Actions e Route Handlers.
- Script de carga de usuários de demonstração (humanos e as três contas de agentes).
- *Pronto quando:* cada usuário de demonstração entra, e o JWT decodificado mostra as claims certas.

**B3 · RLS (P0)**
- RLS ligada em todas as tabelas, com negação por padrão, e políticas segundo a matriz da seção 16.
- Funções no banco para aprovar, recusar, devolver ao lote e desfazer, com checagem de alçada, segregação e aprovação dupla.
- *Pronto quando:* a bateria de testes de RLS passa: cada papel consegue o que deve e é recusado no resto (por exemplo, `agente_operacao` tentando aprovar, `agente_leitor` tentando ler decisões, qualquer papel tentando apagar o log).

**B4 · Painel base (P0)**
- Layout, login, visão geral, fila e detalhe, lendo do Supabase com a sessão do usuário.
- *Pronto quando:* cada papel vê só as telas e os dados que lhe cabem.

### Encontro das trilhas

**5 · Agente de operação e ciclo no servidor (P0)**
- Ciclo da seção 7 rodando numa rota protegida, com cada agente gravando com o próprio JWT.
- Idempotência do ciclo e registro em `ciclos`.
- *Pronto quando:* uma simulação de 02/11 08:00 a 09/11 08:00 roda de ponta a ponta e o painel mostra decisões, log e notificações coerentes.

**6 · Fluxo de aprovação humana (P0)**
- Caixa de entrada, aprovação individual e em lote, aprovação dupla, recusa, devolução ao lote.
- *Pronto quando:* C11 (fracionamento) exige aprovação, um aprovador não consegue aprovar a própria solicitação, e valor acima de R$ 50 mil só passa com PS03.

**7 · Agente de validação (P1)**
- Revisão de retiradas, liberações altas e notificações antes do fechamento.
- *Pronto quando:* o C17 é devolvido ao lote a tempo e acionamentos repetidos são consolidados.

**8 · Tempo real, placar e gargalos (P1)**
- Realtime nas telas principais, placar com e sem GoAudit, indicadores de gargalo, custo de IA, exportação do log.
- *Pronto quando:* avançar o relógio atualiza o painel aberto de outro usuário sem recarregar a página.

**9 · Demo e apresentação (P0)**
- Roteiro baseado nos cenários, contas de demonstração por papel, reinício rápido da simulação.

**Extras (P2):** MFA para aprovadores e diretoria; encadeamento por hash no log (cada linha guarda o hash da anterior, tornando qualquer adulteração detectável); carga da base de entrada no Supabase; notificação real por e-mail.

---

## 14. Entregáveis iniciais

Para começar, entregue:

1. A estrutura de diretórios final, justificando qualquer mudança em relação à seção 12.
2. **Trilha A:** a camada de dados da A1 (leitura tipada, índices e normalizadores, com testes) e o motor de regras R01 a R09 com a tabela de destinos, testado contra os cenários C01 a C04, C08 a C12 e C16.
3. **Trilha B:** as migrações da B1 a B3 (schema, trigger do log, hook de claims, políticas RLS e funções de aprovação) e a bateria de testes de RLS.

Antes de escrever código, liste as dúvidas sobre a base e sobre o modelo de permissões que possam mudar o desenho.

---

## 15. Requisitos

### 15.1 Requisitos funcionais

| ID | Requisito | Prioridade |
| --- | --- | --- |
| RF01 | O usuário entra com e-mail e senha e recebe uma sessão baseada em JWT; sem sessão válida, nenhuma tela ou rota do painel responde | P0 |
| RF02 | O sistema atribui a cada usuário um papel, uma alçada e uma `pessoa_id`, que definem o que ele vê e faz | P0 |
| RF03 | O sistema carrega a base de entrada em CSV, normaliza CNPJ, NF digitada, linha digitável e extratos, e liga cada título à NF, duplicata, OC, contrato, boleto e fornecedor | P0 |
| RF04 | O administrador da simulação inicia, avança, pausa e reinicia a simulação e escolhe o cenário | P0 |
| RF05 | A cada passo do relógio, o sistema avalia todos os títulos dos lotes abertos pelas regras R01 a R14 e grava regras disparadas e evidências | P0 |
| RF06 | O agente de operação libera sozinho os títulos de rotina que passaram em todas as regras e cabem na alçada configurada | P0 |
| RF07 | O agente de operação retira do lote, sozinho, os títulos com falha crítica ou de conferência e notifica a pessoa definida na política | P0 |
| RF08 | O sistema abre solicitação de aprovação quando a política exige (alçada superior, aprovação dupla, fracionamento) e retira o título do lote se não houver aprovação até a margem antes do fechamento | P0 |
| RF09 | O aprovador aprova ou recusa individualmente ou em lote; o sistema impede autoaprovação, aprovação acima da alçada e aprovação dupla com a mesma pessoa duas vezes | P0 |
| RF10 | O sistema lê e classifica e-mails e WhatsApps, confere o remetente com o cadastro e transforma o conteúdo em sinais de risco, sem executar nenhuma instrução do texto | P1 |
| RF11 | O sistema gera alerta ao gestor quando o valor de um fornecedor foge da referência da categoria acima do limite configurado | P1 |
| RF12 | O agente de validação revisa retiradas, liberações acima do valor de corte e notificações antes do fechamento, podendo devolver ao lote, retirar ou consolidar | P1 |
| RF13 | Cada pessoa tem uma caixa de entrada com as notificações agrupadas por assunto | P0 |
| RF14 | A visão geral mostra hora simulada, contagem regressiva dos lotes, contadores, montante em risco e montante protegido | P0 |
| RF15 | A fila de auditoria permite filtrar por destino, risco, urgência, banco, lote e fornecedor | P0 |
| RF16 | O detalhe do título mostra a comparação entre os sistemas, as regras com evidências, o resumo da IA, as mensagens relacionadas e a linha do tempo do log | P0 |
| RF17 | O humano autorizado pode devolver ao lote, manter retido ou desfazer uma decisão do agente, com justificativa obrigatória | P0 |
| RF18 | Toda ação de agente, humano ou motor é registrada no log de auditoria, que é consultável com filtros e exportável em CSV | P0 |
| RF19 | O painel mostra indicadores de gargalo: tempo até a ação humana, títulos parados perto do fechamento, fila por aprovador, taxa de retiradas desfeitas | P1 |
| RF20 | O painel mostra o placar estimado em R$ com e sem GoAudit e o custo de IA por ciclo e acumulado | P1 |
| RF21 | O painel se atualiza em tempo real quando um ciclo termina ou uma decisão muda | P1 |

### 15.2 Requisitos não funcionais

**Segurança**

| ID | Requisito |
| --- | --- |
| RNF01 | RLS ligada em todas as tabelas, com negação por padrão; nenhuma tabela de saída fica acessível sem política explícita |
| RNF02 | O JWT é validado no servidor em toda Server Action e Route Handler; papel, alçada e `pessoa_id` vêm só das claims gravadas pelo servidor |
| RNF03 | A chave `service_role` e o token do AI Proxy nunca chegam ao navegador, ao repositório ou aos logs; o navegador usa só a chave anônima |
| RNF04 | Agentes usam contas próprias, sujeitas à RLS, com o menor conjunto de permissões necessário |
| RNF05 | Texto de mensagens é tratado como dado de terceiros: passado à IA delimitado, sem acesso a ferramentas, com saída validada contra um formato fechado |
| RNF06 | Sessão com expiração curta (padrão 1 hora) e renovação automática; logout invalida a sessão |
| RNF07 | Dados bancários completos aparecem só para papéis que precisam deles; os demais veem os dados mascarados |

**Auditabilidade**

| ID | Requisito |
| --- | --- |
| RNF08 | O log de auditoria é imutável: `UPDATE` e `DELETE` são bloqueados por RLS e por trigger, para qualquer papel |
| RNF09 | Toda decisão é rastreável até as evidências da base (IDs dos registros) e até a regra da política que a motivou |
| RNF10 | O ator de cada linha do log é preenchido pelo banco a partir do JWT, sem depender da aplicação |

**Confiabilidade**

| ID | Requisito |
| --- | --- |
| RNF11 | As regras de negócio são determinísticas: a mesma base e a mesma hora simulada produzem as mesmas decisões |
| RNF12 | O ciclo é idempotente: rodar o mesmo passo duas vezes não duplica ações nem notificações |
| RNF13 | Falha ou lentidão do AI Proxy não trava o ciclo: o título segue pela decisão das regras e o caso vai para revisão humana; erros 429 e 503 têm nova tentativa com espera crescente |
| RNF14 | Operações que mudam mais de uma tabela (aprovar, devolver ao lote) acontecem numa única transação no banco |

**Desempenho e custo**

| ID | Requisito |
| --- | --- |
| RNF15 | Um passo completo do relógio termina em até 30 segundos para uma fila de cerca de 1.000 títulos |
| RNF16 | As telas principais carregam em até 2 segundos com a base de demo |
| RNF17 | A IA é chamada só para mensagens, resumos de decisões não triviais e casos revisados pela validação; títulos de rotina não geram chamada de IA |
| RNF18 | O custo de IA de cada ciclo é medido e exibido |

**Manutenção e portabilidade**

| ID | Requisito |
| --- | --- |
| RNF19 | Nenhum ID, valor ou nome da base de exemplo aparece no código; parâmetros vêm de `politicas.csv` ou da configuração |
| RNF20 | Trocar a pasta da base de entrada por outro cenário com a mesma estrutura funciona sem mudar código |
| RNF21 | TypeScript em modo estrito, tipos do banco gerados automaticamente, testes por regra e por política de RLS |
| RNF22 | Schema, políticas, funções e triggers versionados em migrações reproduzíveis |

**Usabilidade**

| ID | Requisito |
| --- | --- |
| RNF23 | Interface em português, com modo escuro e uso confortável em notebook |
| RNF24 | Cada decisão do agente traz uma explicação curta em linguagem de negócio, sem jargão técnico |
| RNF25 | Ações frequentes (aprovar, devolver ao lote) em no máximo dois cliques a partir da fila ou da caixa de entrada |

---

## 16. Autenticação e RLS

### 16.1 Papéis

| Papel | Quem | Base |
| --- | --- | --- |
| `analista_cp` | Analistas de contas a pagar | `usuarios_sistema.csv` |
| `aprovador` | Aprovadores do financeiro | `usuarios_sistema.csv` |
| `coordenacao_cp` | Renata Paiva (PS01), segunda aprovação | `politicas.csv` |
| `tesouraria` | Marcos Teles (PS02) | `politicas.csv` |
| `diretoria` | Helena Duarte (PS03) | `politicas.csv` |
| `auditor` | Auditoria e controladoria | `usuarios_sistema.csv`, `politicas.csv` |
| `gestor_area` | Compradores e gestores de contrato (PS04 a PS07, PS10, PS11) | `politicas.csv` |
| `juridico` | Lívia Campos (PS08) | `politicas.csv` |
| `agente_operacao`, `agente_validacao`, `agente_leitor` | Contas dos agentes | Criadas pelo sistema |
| `admin_simulacao` | Quem conduz a demo | Criada pelo sistema |

### 16.2 Matriz de acesso (resumo)

L = lê, I = insere, A = atualiza, F = só pela função do banco, — = sem acesso.

| Tabela | analista_cp | aprovador / coordenação / diretoria | tesouraria | auditor | gestor_area / jurídico | agente_operacao | agente_validacao | agente_leitor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `decisoes` | L | L, F | L | L | L (só os títulos em que é dono) | L, I, A | L, A | — |
| `movimentos_lote` | L | L, F | L | L | — | L, I | L, I | — |
| `solicitacoes_aprovacao` | L, I | L | L | L | L (só as suas) | L, I | L | — |
| `aprovacoes` | L | L, F | L | L | — | — | — | — |
| `alertas` | L | L, A | L | L | L, A (só os seus) | L, I, A | L, A | — |
| `notificacoes` | L, A (só as suas) | L, A (só as suas) | L, A (só as suas) | L, A (só as suas) | L, A (só as suas) | I | I | — |
| `mensagens_processadas` | L | L | — | L | — | L | L | I |
| `log_auditoria` | L | L | L | L | L (só dos seus títulos) | I | I | I |
| `ciclos`, `simulacoes` | L | L | L | L | — | L, I | L | — |

`admin_simulacao` gerencia `simulacoes` e `ciclos`. Ninguém, nem o administrador, atualiza ou apaga `log_auditoria`.

### 16.3 Regras que a função de aprovação impõe

- O aprovador não pode ser quem solicitou nem quem lançou o título (segregação).
- O valor considerado é a soma do fornecedor e da NF no mesmo dia (fracionamento).
- A alçada do JWT precisa cobrir o valor: aprovador até R$ 50 mil; acima disso, só a diretoria.
- Aprovação dupla exige duas aprovações de pessoas diferentes: aprovador e coordenação (PS01), ou aprovador e diretoria (PS03) acima de R$ 50 mil.
- Toda aprovação ou recusa grava a linha no log na mesma transação.
