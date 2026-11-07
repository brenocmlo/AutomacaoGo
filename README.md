# GoAudit

MVP do desafio **Pagamentos** do GoHacks Talent 2026: a cada hora simulada, confere cada título agendado contra todos os sistemas e decide se ele é liberado, retirado do lote, mandado para aprovação ou se gera um alerta ao gestor. O prompt completo está em [prompt_de_desenvolvimento_goaudit_v3_1.md](prompt_de_desenvolvimento_goaudit_v3_1.md); a integração com contratos, em [prompt_integracao_vinculo_contratos.md](prompt_integracao_vinculo_contratos.md).

## Como rodar

```bash
npm install
npm test                 # normalizadores, ligação da base, cenários C01–C29, critérios de contratos e migrações/RLS offline (PGlite)
npm run cenarios:gerar   # regenera data/cenarios a partir da base
npm run demo:montar      # data/base + data/cenarios → data/demo
npm run relatorio        # motor sobre a base original: destinos, regras e títulos não ligados
```

### Supabase (nuvem)

1. Crie o projeto e copie `.env.example` para `.env.local`, preenchendo as chaves e as senhas de demo.
2. `npx supabase login`, depois `npm run db:link -- --project-ref <ref>` e `npm run db:push`.
3. No painel: **Authentication → Hooks → Customize Access Token** → função `public.custom_access_token_hook`.
4. `npm run seed:usuarios` cria as contas de demonstração (e-mails `@example.com`).
5. `npm run test:rls` roda a bateria de RLS contra o projeto real.

## Estrutura

```
config/goaudit.config.json   parâmetros que não estão em politicas.csv (margens, faixas, quem acionar)
data/
  base/          CSVs originais do desafio (somente leitura)
  complementos/  arquivos FICTÍCIOS que a base não traz (índices IPCA/IGP-M); ver LEIAME.md
  cenarios/      um diretório por cenário com as linhas a acrescentar + cenarios_esperados.csv
  demo/          base montada (gerada, fora do git)
supabase/
  migrations/    schema, claims do JWT, log imutável, RLS, funções de aprovação
  tests/         stub do ambiente Supabase para testar as migrações offline
  config.toml    configuração da CLI (hook de claims ligado)
src/
  app/           Next.js (painel: etapa B4)
  lib/
    config/      leitura de politicas.csv (formato achatado) e da configuração
    data/        leitura de CSV, normalizadores, recorte por hora de chegada, índices e dossiê do título
    clock/       relógio simulado, calendário bancário, urgência
    rules/       R01–R11 e R13, uma regra por arquivo; destino.ts (seção 5.1); motor.ts
    contratos/   vínculo título × contrato, competência, valor esperado e desvios D01–D10 (substitui a R12)
    agents/      agente de operação (destinos, notificações, contratos) e ciclo do relógio
scripts/         gerar cenários, montar demo, relatório, carga de usuários
tests/           Vitest; tests/rls roda contra o Supabase real
```

### Diferenças em relação à seção 12 do prompt

| Mudança | Por quê |
| --- | --- |
| `config/` na raiz, fora de `src/lib/config` | É dado e não código: dá para trocar sem recompilar, e o `src/lib/config` só o lê. |
| `supabase/seed/` → `scripts/carregar-usuarios.ts` | Criar usuários exige a API admin do Auth, o que não é possível em SQL puro. |
| `supabase/tests/` guarda o stub, e os testes ficam em `tests/` | Os testes de RLS rodam em duas camadas: offline com PGlite em `tests/migracoes.test.ts`, a cada `npm test`, e contra a nuvem em `tests/rls/`. Não é preciso pgTAP nem Docker. |
| `scripts/gerar-cenarios.ts` | Os cenários precisam de linha digitável, chave de acesso e CNPJ de filial com dígitos verificadores válidos, o que é inviável de digitar à mão. O gerador escolhe as entidades por critério, sem IDs fixos, e grava CSVs versionados. |
| `src/lib/ai` ainda não existe | Entra com o leitor de mensagens (A3). |

## Decisões de desenho

- **Perfis mínimos (6):** `aprovador`, `consulta`, `admin`, `agente_operacao`, `agente_validacao` e `agente_leitor`.
  - A alçada vem no JWT. PS01 (coordenação) e PS03 (diretoria) são aprovadores identificados pelo `pessoa_id`, o que basta para a aprovação dupla.
  - Tesouraria, controladoria, gestores e jurídico entram como `consulta`.
  - Os analistas não têm login no MVP.
- **Título conferido acima da alçada do agente continua no lote** se ninguém aprovar, que é o comportamento atual (o tesoureiro assina). Só R08 e R09 retiram o título quando a margem antes do fechamento acaba.
- **Chegada por carimbo de tempo:** cada arquivo é filtrado pela hora simulada. Extratos, que só têm data, ficam visíveis a partir de `chegada.extrato_hora_disponivel`.
- **Duplicidade:** só a cópia (lançada depois) é retirada, e o original segue. **Fracionamento** soma uma vez por parcela, porque cópias da mesma parcela já são caso de R01.
- **R13:** usuário desligado retira o título. Admissão recente só gera alerta, para não travar os títulos legítimos dos analistas novos.
- **R14** entra com o leitor de mensagens.

## Contratos (vínculo e desvio)

A antiga R12 (variação mensal) foi substituída pelo módulo `src/lib/contratos`:

- **Vínculo**, nesta ordem: OC do título = OC do contrato (alta); categoria dispensada de OC, pelo fornecedor (alta); frete da integração (média). Título de OC pontual do mesmo fornecedor **não** é do contrato (segue as 3 vias); título sem OC em categoria que exige OC vira D10.
- **Competência**: deduzida do vencimento e do `dia_vencimento` (dia não útil vai para o próximo útil e mantém a competência). Frete usa o mês do vencimento.
- **Valor esperado**: fixo = valor mensal (± R$ 0,10; com atraso, até multa + juros pro rata da política); mês de reajuste = do valor vigente até vigente × (1 + índice) + 0,5 ponto; utilidades = média das 3 últimas competências pagas ± 25%; frete = estimativa × fator sazonal, de −50% a +70%. Tudo em `config/goaudit.config.json → contratos`.
- **Desvios**: D01, D03, D05, D06, D08 (quando o destino também mudou) e D10 retiram do lote como falha de conferência; D02, D04, D07 e D09 só alertam. O aviso vai ao `gestor_pessoa_id` do contrato (e PS01 quando a tabela pede).
- **Rotina contratual**: vínculo alto, valor na faixa, único na competência, contrato vigente e R06/R07 sem falha → liberado na alçada do agente ou "conforme contrato" (selo que permite aprovar em lote; acima de R$ 50 mil, a diretoria).
- **R04** não compara mais a NF com o valor mensal quando o título está na OC do próprio contrato: o módulo de contratos faz isso por competência, considerando reajuste e atraso.
- **Supabase**: migração 7 cria `vinculos_contrato` e `competencias_contrato` e acrescenta `contrato_id`, `competencia` e `gestor_pessoa_id` em `alertas` (tipo `contrato`). O gestor de área (papel `consulta`) vê só os contratos em que é gestor; o leitor de mensagens não vê nada.
- **Índices de reajuste**: a base não traz; `data/complementos/indices_reajuste.csv` é fictício.
- O cenário C13 (aluguel acima do contrato) da v3 é coberto por C19.
