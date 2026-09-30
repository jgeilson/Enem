/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import { QuestaoFísica } from './types';

export const THEMES_LIST = [
  'Mecânica',
  'Eletricidade e Magnetismo',
  'Termologia',
  'Óptica',
  'Ondulatória',
  'Física Moderna'
] as const;

export const THEME_FILENAMES: Record<string, string> = {
  'Mecânica': 'mecanica.tex',
  'Eletricidade e Magnetismo': 'eletricidade_e_magnetismo.tex',
  'Termologia': 'termologia.tex',
  'Óptica': 'optica.tex',
  'Ondulatória': 'ondulatoria.tex',
  'Física Moderna': 'fisica_moderna.tex'
};

export function getThemeFilename(theme: string): string {
  if (THEME_FILENAMES[theme]) {
    return THEME_FILENAMES[theme];
  }
  const sanitized = theme
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${sanitized || 'outros'}.tex`;
}

/**
 * Normaliza e formata o texto para LaTeX, convertendo unidades comuns e notações
 * para o padrão matemático quando apropriado (ex: $50\\, W$, $10\\, m/s^2$).
 */
export function formatToLatex(text: string): string {
  if (!text) return '';

  let res = text.trim();

  // Substituir expoentes Unicode usuais por notação LaTeX
  res = res.replace(/(\d+)\s*[xX*·]\s*10\^?([+-]?\d+)/g, '$$$1 \\times 10^{$2}$$');
  res = res.replace(/10\^?([+-]?\d+)/g, '$$10^{$1}$$');
  res = res.replace(/10⁰/g, '$10^0$');
  res = res.replace(/10¹/g, '$10^1$');
  res = res.replace(/10²/g, '$10^2$');
  res = res.replace(/10³/g, '$10^3$');
  res = res.replace(/10⁴/g, '$10^4$');
  res = res.replace(/10⁵/g, '$10^5$');
  res = res.replace(/10⁶/g, '$10^6$');
  res = res.replace(/10⁻¹/g, '$10^{-1}$');
  res = res.replace(/10⁻²/g, '$10^{-2}$');
  res = res.replace(/10⁻³/g, '$10^{-3}$');
  res = res.replace(/10⁻⁴/g, '$10^{-4}$');
  res = res.replace(/10⁻⁵/g, '$10^{-5}$');
  res = res.replace(/10⁻⁶/g, '$10^{-6}$');

  // Unidades comuns em itálico matemático com espaçamento padrão
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*m\/s\^?2/g, '$$$1\\, m/s^2$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*m\/s²/g, '$$$1\\, m/s^2$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*m\/s(?![a-zA-Z0-9^²])/g, '$$$1\\, m/s$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*km\/h/g, '$$$1\\, km/h$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*W(?![a-zA-Z0-9])/g, '$$$1\\, W$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*kW(?![a-zA-Z0-9])/g, '$$$1\\, kW$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*kWh(?![a-zA-Z0-9])/g, '$$$1\\, kWh$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*J(?![a-zA-Z0-9])/g, '$$$1\\, J$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*kJ(?![a-zA-Z0-9])/g, '$$$1\\, kJ$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*Hz(?![a-zA-Z0-9])/g, '$$$1\\, Hz$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*kHz(?![a-zA-Z0-9])/g, '$$$1\\, kHz$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*MHz(?![a-zA-Z0-9])/g, '$$$1\\, MHz$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*cal(?![a-zA-Z0-9])/g, '$$$1\\, cal$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*kcal(?![a-zA-Z0-9])/g, '$$$1\\, kcal$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*V(?![a-zA-Z0-9])/g, '$$$1\\, V$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*A(?![a-zA-Z0-9])/g, '$$$1\\, A$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*Ω/g, '$$$1\\, \\Omega$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*ohms?/gi, '$$$1\\, \\Omega$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*N(?![a-zA-Z0-9])/g, '$$$1\\, N$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*kg(?![a-zA-Z0-9])/g, '$$$1\\, kg$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*°C/g, '$$$1\\, ^\\circ\\text{C}$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*K(?![a-zA-Z0-9])/g, '$$$1\\, K$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*h(?![a-zA-Z0-9])/g, '$$$1\\, h$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*min(?![a-zA-Z0-9])/g, '$$$1\\, min$$');
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*s(?![a-zA-Z0-9])/g, '$$$1\\, s$$');

  // Ajustar caracteres de porcentagem (20% -> 20\%)
  res = res.replace(/(\d+)\s*%/g, '$1\\%');

  // Substituir 'm·v²/2' por '$m \\cdot v^2 / 2$' se solto
  res = res.replace(/m·v²\/2/g, '$\\frac{m \\cdot v^2}{2}$');
  res = res.replace(/·/g, '\\cdot ');

  // Evitar duplicações de cifrões caso ocorram ($$...$$)
  res = res.replace(/\${2,}/g, '$');

  return res;
}

/**
 * Limpa o texto da alternativa para não repetir "A)", "B)", etc.,
 * já que o ambiente \begin{alternativas} gera os itens automaticamente.
 */
export function formatAlternativaTexto(texto: string): string {
  if (!texto) return '';
  const limpo = texto.replace(/^[A-Ea-e][\)\.\:\-]\s*/, '').trim();
  return formatToLatex(limpo);
}

export interface LatexExportOptions {
  includeComments?: boolean; // Se inclui % Questão 94 (ENEM 2025) | Gabarito: A
  includeResolucao?: boolean; // Se inclui % Resolução Didática: ...
}

/**
 * Converte uma questão individual no formato LaTeX especificado pelo usuário:
 * 
 * \questao Enunciado...
 * \begin{alternativas}
 * \item texto A
 * \item texto B
 * \item texto C
 * \item texto D
 * \item texto E
 * \end{alternativas}
 */
export function questionToLatex(q: QuestaoFísica, options: LatexExportOptions = { includeComments: true }): string {
  const parts: string[] = [];

  if (options.includeComments) {
    parts.push(`% -------------------------------------------------------------`);
    parts.push(`% ${q.numero} | Tema: ${q.tema} | Subtema: ${q.subtema}`);
    parts.push(`% Gabarito Oficial: (${q.gabarito})`);
    if (options.includeResolucao && q.resolucao) {
      const resLines = q.resolucao.split('\n').map(l => `% [Resolução] ${l}`).join('\n');
      parts.push(resLines);
    }
    parts.push(`% -------------------------------------------------------------`);
  }

  // Enunciado
  const enunciadoLatex = formatToLatex(q.enunciado);
  parts.push(`\\questao ${enunciadoLatex}`);

  // Tabela identificada na questão (se houver)
  if (q.tabela && Array.isArray(q.tabela.cabecalho) && q.tabela.cabecalho.length > 0) {
    const colCount = q.tabela.cabecalho.length;
    const colAlign = Array(colCount).fill('c').join('|');
    const headerCols = (q.tabela.cabecalho || []).map(c => `\\textbf{${formatToLatex(c)}}`).join(' & ');
    
    parts.push(`\\begin{table}[htbp]`);
    parts.push(`  \\centering`);
    if (q.tabela.titulo) {
      parts.push(`  \\caption{${formatToLatex(q.tabela.titulo)}}`);
    }
    parts.push(`  \\begin{tabular}{|${colAlign}|}`);
    parts.push(`    \\hline`);
    parts.push(`    ${headerCols} \\\\`);
    parts.push(`    \\hline`);
    if (Array.isArray(q.tabela.linhas) && q.tabela.linhas.length > 0) {
      for (const row of q.tabela.linhas) {
        const rowCols = (Array.isArray(row) ? row : [row]).map(cell => formatToLatex(cell)).join(' & ');
        parts.push(`    ${rowCols} \\\\`);
      }
      parts.push(`    \\hline`);
    }
    parts.push(`  \\end{tabular}`);
    if (q.tabela.legenda) {
      parts.push(`  \\par\\vspace{2pt}\\footnotesize ${formatToLatex(q.tabela.legenda)}`);
    }
    parts.push(`\\end{table}`);
  }

  // Figura ou Gráfico identificado na questão (se houver)
  if (q.figura) {
    parts.push(`% [ELEMENTO VISUAL IDENTIFICADO: ${q.figura.tipo.toUpperCase()}]`);
    if (q.figura.titulo) {
      parts.push(`% Título: ${q.figura.titulo}`);
    }
    parts.push(`% Descrição detalhada do elemento visual para referência do professor:`);
    parts.push(`% ${q.figura.descricao.replace(/\n/g, '\n% ')}`);
    if (q.figura.dadosVisuais && q.figura.dadosVisuais.length > 0) {
      parts.push(`% Dados extraídos da imagem: ${q.figura.dadosVisuais.join(' | ')}`);
    }
    
    const numMatch = q.numero.match(/\d+/);
    const numStr = numMatch ? numMatch[0] : 'xx';
    const filename = `figura_questao_${numStr}.png`;
    
    parts.push(`\\begin{figure}[htbp]`);
    parts.push(`  \\centering`);
    parts.push(`  % Inserção ativa de imagem (substitua pelo arquivo correspondente '${filename}'):`);
    parts.push(`  \\includegraphics[width=0.65\\linewidth]{${filename}}`);
    parts.push(`  \\caption{${formatToLatex(q.figura.titulo || q.figura.descricao.slice(0, 80))}}`);
    parts.push(`\\end{figure}`);
  }

  // Alternativas
  parts.push(`\\begin{alternativas}`);
  if (q.alternativas && q.alternativas.length > 0) {
    for (const alt of q.alternativas) {
      const itemTexto = formatAlternativaTexto(alt.texto);
      parts.push(`\\item ${itemTexto}`);
    }
  }
  parts.push(`\\end{alternativas}`);

  return parts.join('\n');
}

/**
 * Gera o conteúdo completo de um arquivo .tex para um conjunto de questões de um mesmo tema.
 */
export function generateThemeLatexFile(
  tema: string,
  questoes: QuestaoFísica[],
  options: LatexExportOptions = { includeComments: true }
): string {
  const header = [
    `% =============================================================`,
    `% QUESTÕES DE FÍSICA DO ENEM - TEMÁTICA: ${tema.toUpperCase()}`,
    `% Total de questões: ${questoes.length}`,
    `% Gerado automaticamente pelo EnemFísica`,
    `% =============================================================\n`
  ].join('\n');

  const questoesLatex = questoes
    .map(q => questionToLatex(q, options))
    .join('\n\n');

  return `${header}\n${questoesLatex}\n`;
}

/**
 * Agrupa todas as questões da aplicação pelos seus temas e gera um dicionário
 * { [nome_do_arquivo]: conteudo_tex }.
 */
export function generateAllThemesFiles(
  questoes: QuestaoFísica[],
  options: LatexExportOptions = { includeComments: true }
): Record<string, { tema: string; filename: string; count: number; content: string }> {
  const agrupado: Record<string, QuestaoFísica[]> = {};

  for (const q of questoes) {
    const tema = q.tema || 'Geral';
    if (!agrupado[tema]) {
      agrupado[tema] = [];
    }
    agrupado[tema].push(q);
  }

  const resultado: Record<string, { tema: string; filename: string; count: number; content: string }> = {};

  for (const [tema, items] of Object.entries(agrupado)) {
    const filename = getThemeFilename(tema);
    const content = generateThemeLatexFile(tema, items, options);
    resultado[filename] = {
      tema,
      filename,
      count: items.length,
      content
    };
  }

  return resultado;
}

/**
 * Dispara o download de um único arquivo de texto (.tex) no navegador.
 */
export function downloadLatexFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/x-tex;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Dispara o download de um arquivo ZIP contendo um arquivo .tex para cada tema.
 */
export async function downloadAllThemesZip(
  files: Record<string, { tema: string; filename: string; count: number; content: string }>,
  zipFilename = 'enem_fisica_latex_por_tema.zip'
) {
  const zip = new JSZip();

  for (const file of Object.values(files)) {
    zip.file(file.filename, file.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
