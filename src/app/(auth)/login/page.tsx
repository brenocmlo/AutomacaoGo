import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Card, PAPEIS } from '@/components/ui';
import { contasDemoHumanas } from '@/lib/auth/contas-demo';
import { contexto } from '@/lib/painel/dados';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { FormularioLogin } from './formulario';

export default function Login() {
  const configurado = supabaseConfigurado();
  const contas = configurado
    ? contasDemoHumanas(contexto().base, process.env.ADMIN_EMAIL).map((c) => ({
        email: c.email,
        nome: c.nome,
        rotulo: `${PAPEIS[c.papel]}${c.pessoa_id ? ` · ${c.pessoa_id}` : ''}`,
      }))
    : [];

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="size-6 text-accent" />
          <div>
            <h1 className="font-semibold">GoAudit</h1>
            <p className="text-xs text-muted">Auditoria de pagamentos antes de o dinheiro sair</p>
          </div>
        </div>
        {configurado ? (
          <FormularioLogin contas={contas} />
        ) : (
          <div className="space-y-3 text-sm">
            <p>O Supabase ainda não está configurado, então o painel roda em <strong>modo local</strong>, sem login.</p>
            <p className="text-muted">Preencha o <code>.env.local</code> (veja o <code>.env.example</code>) para ativar o login.</p>
            <Link href="/" className="block w-full rounded-md bg-accent py-2 text-center font-medium text-white">Abrir o painel</Link>
          </div>
        )}
      </Card>
    </main>
  );
}
