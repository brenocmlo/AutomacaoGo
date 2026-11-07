# Complementos fictícios

Arquivos que **não vêm da base do desafio** e foram inventados para o GoAudit funcionar.
Cada linha traz `ficticio = sim`. Nada aqui é dado real.

| Arquivo | O que é |
| --- | --- |
| `indices_reajuste.csv` | IPCA e IGP-M acumulados em 12 meses, por mês de referência (`AAAA-MM`). Usado para calcular o valor esperado de um contrato no mês de reajuste. `acumulado_12m` é uma fração (0,0449 = 4,49%). |

A base do desafio só diz o nome do índice de cada contrato (`indice_reajuste`) e o mês do reajuste.
O carregador lê o arquivo da pasta da base, se estiver lá, e senão desta pasta.
