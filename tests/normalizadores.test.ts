import { describe, expect, it } from 'vitest';
import {
  cnpjDigitos, dataBRparaISO, decodificarLinhaDigitavel, nfNormalizada, nomeAbreviadoCasa, parcela,
  parseHistoricoLitoral, raizCnpj, valorBR,
} from '@/lib/data/normalizadores';

describe('CNPJ', () => {
  it('remove pontuação e extrai a raiz', () => {
    expect(cnpjDigitos('12.345.678/0001-90')).toBe('12345678000190');
    expect(raizCnpj('12.345.678/0002-71')).toBe('12345678');
    expect(raizCnpj('12345678000190')).toBe(raizCnpj('12.345.678/0001-90'));
    expect(raizCnpj('')).toBe('');
  });
});

describe('NF digitada', () => {
  it.each([
    ['000123', '123'],
    ['123-1', '123'],
    ['123/1', '123'],
    ['123', '123'],
    ['0', '0'],
    ['', ''],
    [' 00045 ', '45'],
  ])('%s → %s', (entrada, esperado) => expect(nfNormalizada(entrada)).toBe(esperado));
});

describe('parcela', () => {
  it('lê n/total', () => expect(parcela('2/3')).toEqual({ n: 2, total: 3 }));
  it('rejeita lixo', () => expect(parcela('x')).toBeNull());
});

describe('formatos brasileiros', () => {
  it('valor', () => {
    expect(valorBR('-4.129,58')).toBe(-4129.58);
    expect(valorBR('50.000,00')).toBe(50000);
    expect(valorBR('')).toBeNull();
  });
  it('data', () => expect(dataBRparaISO('03/08/2026')).toBe('2026-08-03'));
});

describe('linha digitável', () => {
  // Montada à mão no layout do dicionário: banco 341, fator 1544 (20/08/2026), valor 21.249,41.
  const campo1 = '3419' + '12340'; // banco+moeda+5 primeiros do campo livre
  const campo2 = '1234567890';
  const campo3 = '1234567890';
  const dv = (c: string) => {
    let soma = 0, peso = 2;
    for (let i = c.length - 1; i >= 0; i--) {
      let p = Number(c[i]) * peso;
      if (p > 9) p = Math.floor(p / 10) + (p % 10);
      soma += p;
      peso = peso === 2 ? 1 : 2;
    }
    return String((10 - (soma % 10)) % 10);
  };
  const linha = campo1 + dv(campo1) + campo2 + dv(campo2) + campo3 + dv(campo3) + '7' + '1544' + '0002124941';

  it('tem 47 dígitos', () => expect(linha).toHaveLength(47));
  it('extrai banco, vencimento e valor', () => {
    const l = decodificarLinhaDigitavel(linha)!;
    expect(l.banco).toBe('341');
    expect(l.fatorVencimento).toBe(1544);
    expect(l.vencimento).toBe('2026-08-20');
    expect(l.valor).toBe(21249.41);
    expect(l.dvCamposOk).toBe(true);
  });
  it('detecta DV de campo errado', () => {
    const errada = linha.slice(0, 9) + String((Number(linha[9]) + 1) % 10) + linha.slice(10);
    expect(decodificarLinhaDigitavel(errada)!.dvCamposOk).toBe(false);
  });
  it('rejeita tamanho errado', () => expect(decodificarLinhaDigitavel('123')).toBeNull());
});

describe('extrato do Litoral', () => {
  it('PIX', () => expect(parseHistoricoLitoral('PIX ENV 72428 MARIA SOUZA CRI')).toEqual({ tipo: 'PIX', banco: null, nome: 'MARIA SOUZA CRI' }));
  it('TED', () => expect(parseHistoricoLitoral('TED ENV 289 STUDIO EXEMPLO FOT')).toEqual({ tipo: 'TED', banco: '289', nome: 'STUDIO EXEMPLO FOT' }));
  it('boleto', () => expect(parseHistoricoLitoral('PAG BOL 551 EMBALAGENS TESTE')).toMatchObject({ tipo: 'BOLETO', banco: '551' }));
  it('tarifa', () => expect(parseHistoricoLitoral('TAR PAGTO LOTE').tipo).toBe('TARIFA'));
  it('nome abreviado casa por prefixo, sem acento', () => {
    expect(nomeAbreviadoCasa('STUDIO CLARO FOTOG', 'Studio Claro Fotografia Ltda')).toBe(true);
    expect(nomeAbreviadoCasa('GRAFICA RAPIDA IMP', 'Gráfica Rápida Impressos')).toBe(true);
    expect(nomeAbreviadoCasa('OUTRA EMPRESA', 'Studio Claro Fotografia Ltda')).toBe(false);
  });
});
