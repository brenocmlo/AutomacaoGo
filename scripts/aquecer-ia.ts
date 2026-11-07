/**
 * Pré-aquece a leitura de mensagens por IA para a demo ao vivo: chama o AI Proxy uma vez para cada
 * mensagem da base da demo (inclusive as que só chegam durante a simulação, como C05–C07) e grava as
 * respostas no cache em disco (node_modules/.cache/goaudit/refinamentos-ia.json). O servidor lê esse
 * arquivo no primeiro ciclo; o "Nova simulação" seguinte não espera a IA.
 *
 * Uso: npm run demo:aquecer   (pode rodar com o servidor ligado; precisa de AI_PROXY_API_KEY no .env.local)
 * Rodar de novo só chama as mensagens que ainda não têm resposta.
 */
import { config as dotenv } from 'dotenv';
import { iaDisponivel } from '@/lib/ai/proxy';
import { contexto } from '@/lib/contexto';
import { arquivoCacheIA, carregarCacheIA, refinarComIA } from '@/lib/mensagens/ia';

dotenv({ path: '.env.local' });

async function main() {
  if (!iaDisponivel()) {
    console.log('IA indisponível (AI_PROXY_API_KEY ausente ou GOAUDIT_IA=desligada): nada a aquecer. A demo roda só com as regras.');
    return;
  }
  const { base } = contexto();
  const doDisco = carregarCacheIA();
  console.log(`${base.comunicacoes.length} mensagens na base; ${doDisco} respostas já estavam no cache em disco.`);
  const t0 = Date.now();
  const r = await refinarComIA(base.comunicacoes, [], 10);
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Aquecimento: ${r.chamadas} chamadas, ${r.falhas} falhas, ${r.tokensEntrada} tokens de entrada, ${r.tokensSaida} de saída, US$ ${r.custoUsd.toFixed(5)} em ${seg}s.`);
  console.log(`Cache: ${arquivoCacheIA()}`);
  if (r.falhas) console.log(`${r.falhas} mensagens falharam (o ciclo as lê só pelas regras). Rode de novo para tentar só essas.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
