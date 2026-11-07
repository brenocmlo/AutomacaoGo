# GoAudit · Integração: vínculo com contratos e alerta de desvio

## Contexto

O GoAudit já foi implementado a partir do prompt de desenvolvimento v3: Next.js com TypeScript, base de entrada em CSV, motor de regras R01 a R14, agentes de operação e validação, leitor de mensagens, saída no Supabase com JWT e RLS, log de auditoria só de inclusão e painel.

Esta tarefa **integra uma nova funcionalidade ao código existente**: ligar cada pagamento recorrente ao contrato que o autoriza, calcular quanto deveria ser cobrado em cada mês e alertar o gestor do contrato quando o valor foge do esperado. A funcionalidade **substitui a regra R12 (variação mensal)** e a seção 5.2 da v3.

## Antes de escrever código

1. Leia a estrutura atual do projeto e localize: a leitura dos CSVs e os índices, o motor de regras e a tabela de destinos, os agentes, as migrações do Supabase e as políticas RLS, a tabela de alertas, os cenários de teste e as telas do painel.
2. Reaproveite o que existe (normalizadores, calendário bancário, cálculo de multa e juros, alertas, notificações, log, padrão de testes). Não duplique lógica.
3. Liste o que vai alterar e o que vai criar, e aponte qualquer conflito com o código atual antes de começar.

## Dados envolvidos

- `contratos_fornecedores.csv`: `contrato_id`, `fornecedor_id`, `oc_id`, `tipo`, `valor_mensal`, `valor_variavel` (sim/não), `dia_vencimento`, `forma_pagamento`, `inicio_vigencia`, `fim_vigencia_atual`, `indice_reajuste`, `mes_reajuste`, `data_ultimo_reajuste`, `gestor_contrato`, `gestor_pessoa_id`, `status`.
- `pedidos_compra.csv`: OCs do tipo `contrato` têm `valor_mensal` igual ao do contrato.
- `contas_a_pagar.csv` e `agenda_remessa.csv`: títulos, com `oc_id`, valor, vencimento, data de pagamento e lote.
- `fornecedores.csv`: categoria (`utilidades`, `aluguel`, `frete` etc.) e `contrato_id`.
- **Novo arquivo inventado:** `indices_reajuste.csv` com IPCA e IGP-M acumulados em 12 meses por mês (`indice`, `mes_referencia`, `acumulado_12m`). A base do desafio não traz índices; marque o arquivo como fictício.

## Fatos da base que o desenho precisa respeitar

Use como verificação nos testes, nunca como valores fixos no código:

1. **O vínculo forte é pela OC.** Títulos lançados na OC do contrato fixo vêm um por mês, no valor exato. Os mesmos fornecedores (agências) têm muitos títulos em OCs pontuais (campanhas), que **não** são do contrato. Ligar pelo fornecedor gera alarme falso.
2. **Atraso gera acréscimo legítimo.** Há mensalidades pagas cerca de 2,3% acima, de 5 a 9 dias depois do vencimento (multa de 2% + juros de 1% ao mês pro rata).
3. **Utilidades não têm OC.** O vínculo é pelo fornecedor; o consumo oscila cerca de 10%. Há um caso na base de valor 10 vezes menor que a média (provável erro de digitação), que deve ser acusado.
4. **Frete é variável por volume.** A soma mensal varia de −40% a +58% da estimativa contratual, com pico de Black Friday.
5. **Contratos vencendo.** Há contratos com fim de vigência em 30/11/2026, renovação automática e reajuste em dezembro.

## O que implementar

### 1. Vínculo título × contrato

Tentar nesta ordem e gravar método e confiança:

| Ordem | Método | Confiança |
| ---: | --- | --- |
| 1 | `oc_id` do título = `oc_id` do contrato | Alta |
| 2 | Fornecedor com contrato sem OC e categoria dispensada de OC (utilidades) | Alta |
| 3 | Fornecedor com contrato de frete e origem `integracao_frete` | Média |
| 4 | Fornecedor com contrato, título em OC pontual aprovada | Não é do contrato: segue as regras normais de 3 vias |
| 5 | Fornecedor com contrato, título sem OC em categoria que exige OC | Sem vínculo: gera desvio D10 |

Cada título vinculado recebe uma **competência** (mês de referência), deduzida do vencimento e do `dia_vencimento`. Vencimento em fim de semana ou feriado vai para o próximo dia útil e mantém a competência.

### 2. Valor esperado por competência

| Tipo | Valor esperado | Faixa padrão |
| --- | --- | --- |
| Fixo (software, serviço, fee, aluguel) | `valor_mensal` vigente | Exato, ± R$ 0,10; pago com atraso, até valor + multa + juros pro rata |
| Fixo no mês de reajuste | `valor_mensal` × (1 + índice acumulado) | Do valor antigo ao reajustado + 0,5 ponto |
| Utilidades | Média das últimas 3 competências pagas | ±25% |
| Frete | Estimativa mensal × fator sazonal | −50% a +70% |

Todas as faixas, fatores sazonais e prazos ficam em configuração.

### 3. Desvios e ações

| Código | Desvio | Ação do agente de operação | Quem é avisado |
| --- | --- | --- | --- |
| D01 | Valor acima da faixa (fixo) | Retira do lote e alerta | `gestor_pessoa_id` do contrato e PS01 |
| D02 | Valor abaixo da faixa | Alerta de possível erro de digitação, sem retirar | PS01 |
| D03 | Mais de um título na mesma competência (fixo) | Retira os excedentes e alerta | PS01 |
| D04 | Competência sem título até 5 dias úteis antes do vencimento | Alerta de risco de atraso | Gestor do contrato |
| D05 | Reajuste fora do mês previsto ou acima do índice | Retira do lote e alerta | Gestor do contrato |
| D06 | Cobrança fora da vigência ou de contrato encerrado | Retira do lote e alerta | Gestor do contrato e PS01 |
| D07 | Vencimento ou reajuste nos próximos 30 dias | Só aviso | Gestor do contrato |
| D08 | Forma de pagamento diferente da do contrato | Retira se o destino também mudou (cruza com R07) | PS01 |
| D09 | Utilidade ou frete fora da faixa | Alerta; retira só se houver outra falha | Gestor do contrato |
| D10 | Título recorrente sem vínculo (método 5) | Retira do lote e alerta | PS01 e comprador responsável |

- O alerta vai para o gestor nomeado no contrato, não para uma regra genérica por categoria.
- O agente de validação revisa D01, D03, D05, D06 e D10 antes do fechamento do lote e consolida avisos repetidos do mesmo contrato.
- Integre os desvios à tabela de destinos existente: os que retiram do lote entram como falha de conferência; D02, D04, D07 e D09 geram só alerta.

### 4. Rotina contratual

Um título é rotina contratual quando: vínculo de confiança alta, valor na faixa, único na competência, contrato vigente, R06, R07 e R14 sem falha. Dentro da alçada do agente, é liberado. Acima, vai ao aprovador (ou PS03, acima de R$ 50 mil) com o selo **"conforme contrato"**, que permite aprovação em lote.

### 5. Supabase

- Nova migração com as tabelas `vinculos_contrato` (título, contrato, competência, método, confiança) e `competencias_contrato` (contrato, competência, valor esperado, faixa mínima e máxima, valor cobrado, quantidade de títulos, situação), ambas com `simulacao_id`.
- Alertas na tabela `alertas` existente, com tipo `contrato` e o código do desvio.
- **RLS:** gestor de área vê só os contratos em que é `gestor_pessoa_id`; financeiro, auditoria e diretoria veem todos; agentes de operação e validação gravam; leitor de mensagens sem acesso. Acrescente os testes de RLS correspondentes.
- Toda ação nova passa pelo log de auditoria existente.

### 6. Tela de contratos

- **Lista:** tipo, fornecedor, gestor, valor mensal, competência atual, esperado × cobrado, situação, próximo reajuste e vencimento, com filtros por tipo, gestor, situação e "vence ou reajusta em 30 dias".
- **Detalhe:** gráfico mensal esperado × cobrado, títulos de cada competência com link para o detalhe do título, alertas do contrato, vigência e reajuste.
- No detalhe do título que já existe, mostre o contrato vinculado, a competência e o valor esperado.

### 7. Cenários de teste

Acrescente ao `cenarios_esperados.csv`:

| ID | Cenário | Esperado |
| --- | --- | --- |
| C18 | Fee de agência cobrado duas vezes na mesma competência | D03: retira excedente, alerta PS01 |
| C19 | Aluguel 18% acima fora do mês de reajuste | D01/D05: retira, alerta gestor (PS10) |
| C20 | Assinatura reajustada no mês certo, dentro do IPCA | Rotina, liberada |
| C21 | Serviço reajustado no mês certo, 12% acima do índice | D05: retira, alerta gestor |
| C22 | Conta de consumo 10 vezes menor que a média | D02: alerta PS01 |
| C23 | Conta de consumo 60% acima da média | D09: alerta gestor (PS10) |
| C24 | Assinatura sem título a 5 dias úteis do vencimento | D04: alerta gestor (PS11) |
| C25 | Cobrança de contrato com vigência encerrada | D06: retira, alerta gestor e PS01 |
| C26 | Campanha de agência em OC pontual aprovada | Sem desvio contratual; regras normais |
| C27 | Frete de outubro 55% acima da estimativa | Sem desvio (faixa sazonal) |
| C28 | Mensalidade paga 9 dias atrasada com 2,3% a mais | Sem desvio (acréscimo legítimo) |
| C29 | Aluguel acima de R$ 50 mil no valor exato | "Conforme contrato", aguardando PS03 |

O cenário C13 da v3 (aluguel acima do contrato) passa a ser coberto por C19; ajuste ou remova o antigo.

## Critérios de pronto

1. Na base de exemplo, todos os títulos lançados em OC de contrato fixo são vinculados com confiança alta, e nenhum título de campanha de agência é vinculado ao fee.
2. O caso real de utilidade com valor 10 vezes menor é acusado como D02.
3. Os títulos de contrato fixo hoje na agenda saem como rotina (liberados ou "conforme contrato"), sem alerta.
4. Os cenários C18 a C29 passam nos testes, e os testes que já existiam continuam passando.
5. Os testes de RLS mostram que um gestor de área vê só os próprios contratos.
6. A regra R12 antiga foi removida ou substituída, sem alerta duplicado.
7. Nenhum ID ou valor da base aparece no código.
