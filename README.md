# GoAudit

MVP do desafio **Pagamentos** do GoHacks Talent 2026: a cada hora simulada, confere cada título agendado contra todos os sistemas e decide se ele é liberado, retirado do lote, mandado para aprovação ou se gera um alerta ao gestor. O prompt completo está em [prompt_de_desenvolvimento_goaudit_v3_1.md](prompt_de_desenvolvimento_goaudit_v3_1.md).

## Como rodar

```bash
npm install
npm test                 # normalizadores, ligação da base, cenários C01–C16 e migrações/RLS offline (PGlite)
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
| `src/lib/agents`, `ai`, `supabase`, `auth` ainda não existem | Entram nas próximas etapas (A3, B4, 5). |

## Decisões de desenho

- **Perfis mínimos (6):** `aprovador`, `consulta`, `admin`, `agente_operacao`, `agente_validacao` e `agente_leitor`.
  - A alçada vem no JWT. PS01 (coordenação) e PS03 (diretoria) são aprovadores identificados pelo `pessoa_id`, o que basta para a aprovação dupla.
  - Tesouraria, controladoria, gestores e jurídico entram como `consulta`.
  - Os analistas não têm login no MVP.
- **Título conferido acima da alçada do agente continua no lote** se ninguém aprovar, que é o comportamento atual (o tesoureiro assina). Só R08 e R09 retiram o título quando a margem antes do fechamento acaba.
- **Chegada por carimbo de tempo:** cada arquivo é filtrado pela hora simulada. Extratos, que só têm data, ficam visíveis a partir de `chegada.extrato_hora_disponivel`.
- **Duplicidade:** só a cópia (lançada depois) é retirada, e o original segue. **Fracionamento** soma uma vez por parcela, porque cópias da mesma parcela já são caso de R01.
- **R13:** usuário desligado retira o título. Admissão recente só gera alerta, para não travar os títulos legítimos dos analistas novos.
- **R12 e R14** entram junto com o alerta mensal e o leitor de mensagens.
