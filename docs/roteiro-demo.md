# Roteiro do pitch de 5 minutos

Para quem apresenta. A simulação vai de **segunda 02/11/2026 08:00** até **segunda 09/11/2026 08:00**, uma hora simulada por clique. O pitch usa só o começo dela (02/11, de 08:00 a 15:00).

A base da demo (`data/demo`) é a **base do pitch**: 6 títulos nos lotes, que contam 3 histórias. Os dados de apoio (fornecedores, histórico de pagamentos, NFs, DDA, extratos, políticas) continuam lá, porque as regras precisam deles. Os IDs abaixo vêm de `data/demo/cenarios_esperados.csv`; se você regenerar os cenários (`npm run cenarios:gerar`), confira os IDs de novo.

## 1. Tempos

| Tempo | Bloco | Conta | Relógio | Onde |
| --- | --- | --- | --- | --- |
| 0:00 a 0:20 | Abertura | admin | 02/11 08:00 | Visão geral |
| 0:20 a 1:10 | **Rotina**: o que o sistema libera ou deixa conferido | admin | 02/11 08:00 | Rotina e variações, Fila de auditoria |
| 1:10 a 2:55 | **Duplicidade tratada pela IA** (C01) | admin | 02/11 08:00 | Fila de auditoria |
| 2:55 a 4:40 | **Golpe por mensagem** (C05) | admin, depois Renata | 02/11 14:00 e 15:00 | Fila de auditoria, Log e gargalos, Alertas e caixa |
| 4:40 a 5:00 | Fechamento: placar e custo de IA | admin | 02/11 15:00 | Visão geral |

## 2. Contas

Senha de todas: `DEMO_SENHA`. Os e-mails de pessoas são fictícios (`@example.com`). **O admin conduz o relógio e também decide** (aprova, recusa, devolve ao lote, mantém retido), sem limite de alçada. A segregação vale para ele também: quem lançou o título não aprova.

| Papel | Conta | No pitch |
| --- | --- | --- |
| Administração | `admin@gogroup.com` | Conduz tudo e decide. Vê as notificações de quem não tem conta (PS02, PS08). |
| Aprovador (até R$ 50 mil) | `claudia.ferraz@example.com` (Cláudia Ferraz) | Reserva: aprova o que cabe na alçada dela. |
| Coordenadora de contas a pagar (PS01) | `renata.paiva@example.com` (Renata Paiva) | Recebe o aviso de duplicidade e de troca de conta (C01 e C05). |
| Diretora financeira (PS03) | `helena.duarte@example.com` (Helena Duarte) | Reserva: seria quem aprova o aluguel de R$ 73.800 (C12). |
| Gestor de contrato, consulta (PS10) | `tiago.lins@example.com` (Tiago Lins) | Não entra no pitch. |
| Gestora de contrato, consulta (PS11) | `paula.viana@example.com` (Paula Viana) | Não entra no pitch. |
| Agente de operação, de validação e leitor | `agente.operacao@`, `agente.validacao@`, `agente.leitor@example.com` | Contas técnicas dos agentes. Não entram no painel; aparecem no log como atores separados. |

## 3. Roteiro

Os botões do topo avançam o relógio (**+1h**, **+6h**, **+24h**). Cada hora simulada é um ciclo completo. Enquanto roda, o botão mostra um ícone girando: **não clique de novo**.

### 3.1 · Abertura (0:20) · 02/11 08:00

Clicar **Nova simulação** antes de começar (deixe pronto). Na **Visão geral**: 6 títulos na fila, 4 liberados automático, 1 conferido aguardando aprovador e 1 retirado.

> "Todo dia útil o tesoureiro assina um lote de remessa sem conferir título por título. A informação para conferir está em seis sistemas que não conversam. O GoAudit confere cada título contra todos a cada hora e decide: libera, manda para aprovação ou retira do lote. Hoje vou mostrar três situações."

### 3.2 · Rotina (0:50) · 02/11 08:00

1. Menu **Rotina e variações**. Três títulos aparecem como **Rotina**, três como **Fora da rotina**.
2. Buscar `TP900028` (Ecoprint, R$ 4.060,38, caso C09): NF 1,5% acima da OC, **dentro da tolerância**. **Rotina**, liberado automático, sem aviso a ninguém. Mostrar a variação contra a mediana do histórico (cerca de +20%).
3. Buscar `TP900040` (Aldeota Office, R$ 73.800,00, caso C12): aluguel sem NF, **igual ao contrato** `CT-0135`. **Rotina**, selo **Conforme contrato**, status "Conferido, aguarda aprovador" (acima de R$ 50 mil, quem aprova é a diretoria).
4. Abrir `TP900040` na **Fila de auditoria**, bloco **Ações**, e clicar **Aprovar** como admin. Entra "APROVADO" e a linha do tempo mostra "Humano aprovou".
5. Para contraste, mostrar `TP900003` (Mosaico): liberado, mas **−72% contra a mediana**. A tela mostra a variação mesmo quando nada barra o pagamento.

> "O que é rotina passa sem incomodar ninguém, porque cada acionamento desnecessário custa R$ 60. A variação contra o histórico fica visível. O aluguel acima de R$ 50 mil está conforme o contrato, mas só um humano com alçada libera."

### 3.3 · Duplicidade com a IA (1:45) · 02/11 08:00

1. **Fila de auditoria**, buscar `TP900004` (Mosaico, R$ 3.850,37). Status **Retirado**, regra **R01**, aviso para PS01.
2. Bloco **Resumo da IA** (com o nome do modelo): problema, valor, regra e ação recomendada em poucas linhas. A IA explica por que os dois lançamentos são o mesmo título: a NF `000900002` (original `TP900003`) e a NF `900002-1` (cópia `TP900004`) são a mesma NF 900002 depois de tirar zeros e série, com mesmo fornecedor, mesmo valor e mesmo vencimento (04/11).
3. Em **Comparação entre sistemas**, mostrar as duas NFs digitadas. Em **Regras**, o R01 e a evidência `TP900003`: o original **segue no lote**, só a cópia sai.
4. Em **Linha do tempo**: o agente de operação (e não a IA) retirou o título do lote, com o motivo das regras.

> "A decisão é das regras, que são determinísticas e auditáveis. A IA não decide nada: ela recebe o dossiê já estruturado e escreve a explicação em linguagem de negócio para quem vai conferir. Sem IA, o ciclo segue igual e o título só fica sem o resumo."

### 3.4 · Golpe por mensagem (1:45) · 02/11 14:00 e 15:00

1. **Clique:** de 08:00, **+6h** (14:00). Na **Fila de auditoria**, `TP900089` (Talentos RH, R$ 3.250,37) está **Liberado automático**. O `TP900092` (R$ 2.780,37), do mesmo fornecedor, também.
2. **Clique:** **+1h** (15:00). Às 14:20 chegou um WhatsApp (`WA990093`) de um número novo pedindo novos dados bancários e, às 14:45, o cadastro foi alterado sem confirmação. **O canal WhatsApp é fictício** (a base original só tem e-mails).
3. Os dois títulos viram **Retirado** (R07, R09 e R14). Vale para **todos** os títulos do fornecedor. Abrir `TP900089`: **Resumo da IA**, **Mensagens relacionadas** com o selo "canal não oficial".
4. Menu **Log e gargalos**, procurar "classificou mensagem de risco": o **Leitor de mensagens** (conta própria, sem permissão de agir) classificou como troca de dados bancários, risco crítico, com os sinais de pedido de troca de conta, telefone novo citado e remetente fora do cadastro, e a IA refinou o tipo. Quem retirou os títulos foi o **Agente de operação**, outra conta.
5. **Decisão humana**: no `TP900089`, **Manter retido** como admin, com a justificativa "Confirmar pelo telefone do cadastro antes de qualquer pagamento". Fica registrado no log. (Se sobrar tempo: entrar como Renata Paiva em **Alertas e caixa** e mostrar o aviso de PS01. O aviso de PS08 aparece na caixa do admin.)

> "Cada fato sozinho passaria: uma mensagem de um número novo, e depois uma alteração de cadastro. O GoAudit liga os dois e tira os títulos do lote antes de o dinheiro ir para a conta errada. A conta que lê a mensagem não pode liberar nem retirar nada, e a decisão final é de uma pessoa."

### 3.5 · Fechamento (0:20) · 02/11 15:00

Voltar à **Visão geral**.

- **Retirados:** 3 títulos, R$ 9.881,11 barrados (`TP900004`, `TP900089`, `TP900092`), nenhum título legítimo travado. No **Placar estimado**, o "sem GoAudit" fica em zero até o lote fechar; o bloco já mostra o valor barrado.
- **Custo de IA:** card **Custo de IA** com chamadas e tokens (a leitura das mensagens e os resumos). O proxy não informa preço em dólar, então o valor pode aparecer como US$ 0,0000: leia as chamadas e os tokens.
- **Se sobrar tempo:** **+24h** duas vezes (04/11 15:00, depois do fechamento das 10:00). O lote vai ao banco sem os retirados, e o placar mostra o "sem GoAudit" em **−R$ 9.881,11** contra **R$ 0,00** com GoAudit (se o `TP900040` foi aprovado). Cada +24h leva alguns segundos; não faça isso se o tempo estiver apertado.

> "Valor protegido em reais, cada decisão com evidência, cada ação com responsável no log, a IA só explicando e lendo mensagens, e nenhum pagamento legítimo travado."

## 4. Checklist (15 minutos antes)

- [ ] `.env.local` preenchido: `DEMO_SENHA`, `AI_PROXY_API_KEY`, chaves do Supabase, contas dos agentes e `ADMIN_EMAIL`.
- [ ] Supabase no ar, migrações aplicadas (inclusive a 8, que deixa o admin aprovar: `supabase/.temp/aplicar_migracao_8.sql`) e contas criadas (`npm run seed:usuarios`).
- [ ] `npm run demo:montar` (monta a base do pitch). O topo da tela mostra "Base original" se isso faltou.
- [ ] `npm run demo:aquecer`: guarda em disco a leitura da mensagem (1) e os 3 resumos da IA. Sem isso, o primeiro ciclo espera a IA (alguns segundos por resumo).
- [ ] `npm run dev` rodando e `http://localhost:3000/login` aberto.
- [ ] Entrar como **admin** e clicar **Nova simulação**: relógio em 02/11 08:00, 6 títulos.
- [ ] Ensaiar uma vez inteira e clicar **Nova simulação** no final (é o que se faz entre uma apresentação e outra).

## 5. Plano B

| Se acontecer | Faça |
| --- | --- |
| **A IA falhar ou estiver lenta** | O ciclo segue pelas regras: o título é retirado do mesmo jeito, mas fica sem o bloco "Resumo da IA", e a mensagem vai para revisão humana. Para não esperar tentativas, ponha `GOAUDIT_IA=desligada` no `.env.local`, reinicie o `npm run dev` e clique **Nova simulação**. Fala: "A IA explica; sem ela, a proteção continua." |
| **O Realtime falhar** (a tela não atualiza) | Aperte F5 depois de cada avanço do relógio. Os dados estão no banco. |
| **A tela travar durante um +6h** | Aguarde. Cada ciclo é idempotente. Se o navegador der erro, recarregue e clique **+1h**: a hora já feita é pulada. |
| **O botão Aprovar der erro de permissão** | A migração 8 não foi aplicada. Cole `supabase/.temp/aplicar_migracao_8.sql` no SQL Editor do Supabase, saia e entre de novo como admin. Enquanto isso, entre como Helena Duarte para aprovar o `TP900040`. |
| **O Supabase cair** | O painel entra em "Modo local": decisões recalculadas pelo servidor, sem login, aprovações nem placar. Serve para mostrar as histórias na Fila de auditoria. Tire as chaves do `.env.local` e reinicie. |
| **Uma conta não entra** | Entre como admin: o menu **Equipe** cria ou refaz um acesso na hora. |
| **A simulação ficou numa hora errada** | **Nova simulação** e refaça só a parte que precisa. |

## 6. Outras bases

- `npm run demo:montar -- --todos-cenarios`: todos os cenários plantados (usada para conferir o motor, não para o pitch).
- `npm run demo:montar -- --completa`: a base inteira, com os títulos de fundo.
