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

  // Format tables (\begin{tabular} ... \end{tabular}) to have clean newlines and indentation around them
  res = res.replace(/\\begin\{tabular\}/g, '\n\n\\begin{tabular}');
  res = res.replace(/\\end\{tabular\}/g, '\\end{tabular}\n\n');

  // Format list environments (itemize, enumerate) to have clean newlines and indentation
  res = res.replace(/\\begin\{itemize\}/g, '\n\n\\begin{itemize}');
  res = res.replace(/\\end\{itemize\}/g, '\\end{itemize}\n\n');
  res = res.replace(/\\begin\{enumerate\}/g, '\n\n\\begin{enumerate}');
  res = res.replace(/\\end\{enumerate\}/g, '\\end{enumerate}\n\n');

  // Ensure individual list items start on their own line with standard indentation
  res = res.replace(/\\item\s+/g, '\n  \\item ');

  // Clean up any potential multiple consecutive empty lines to maintain beautiful spacing
  res = res.replace(/\n{3,}/g, '\n\n');

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
    parts.push(`% -------------------------------------------------------------`);
  }

  // Enunciado
  const yearMatch = q.numero.match(/20\d{2}/);
  const year = yearMatch ? yearMatch[0] : '2025';

  const enunciadoLatex = formatToLatex(q.enunciado);
  parts.push(`\\questao (${year}) ${enunciadoLatex}`);

  // Se a questão possui figura (ou se for uma questão antiga com o objeto figura)
  const temAlgumaFigura = q.temFigura || !!q.figura;
  if (temAlgumaFigura) {
    const numMatch = q.numero.match(/\d+/);
    const numStr = numMatch ? numMatch[0] : 'xx';
    
    parts.push(`\\begin{figure}[htbp]`);
    parts.push(`  \\centering`);
    parts.push(`  % Inserção de imagem correspondente a esta questão:`);
    
    if (q.figurasBase64 && q.figurasBase64.length > 0) {
      for (let index = 0; index < q.figurasBase64.length; index++) {
        const filename = `figura_questao_${numStr}_fig${index + 1}_${year}.png`;
        parts.push(`  \\includegraphics[width=0.65\\linewidth]{imagens/${filename}}`);
      }
    } else {
      const filename = `figura_questao_${numStr}_${year}.png`;
      parts.push(`  \\includegraphics[width=0.65\\linewidth]{imagens/${filename}}`);
    }
    
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
 * Converte uma imagem vetorial PDF codificada em base64 para uma imagem PNG em base64 (removendo o cabeçalho data URI)
 * utilizando o PDF.js do navegador de forma assíncrona.
 */
export async function convertPdfBase64ToPngBase64(base64Data: string): Promise<string> {
  // Ensure pdfjsLib is loaded in the window
  if (!(window as any).pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Falha ao carregar o conversor de PDF para PNG.'));
      document.head.appendChild(script);
    });
  }

  const pdfjsLib = (window as any).pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

  // Decode base64 bytes
  const binaryString = window.atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdfDoc = await loadingTask.promise;
  const page = await pdfDoc.getPage(1);

  // Render at 3.5x scale for stunning high-definition quality in LaTeX
  const viewport = page.getViewport({ scale: 3.5 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível obter o contexto 2D do Canvas.');

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

/**
 * Dispara o download de um arquivo ZIP contendo um arquivo .tex para cada tema e os arquivos das figuras recortadas em PNG.
 */
export async function downloadAllThemesZip(
  files: Record<string, { tema: string; filename: string; count: number; content: string }>,
  zipFilename = 'enem_fisica_latex_por_tema.zip',
  questoes: QuestaoFísica[] = []
) {
  const zip = new JSZip();

  for (const file of Object.values(files)) {
    zip.file(file.filename, file.content);
  }

  // Adiciona as figuras cortadas convertidas em formato de imagem (.png) no ZIP dentro da pasta 'imagens/'
  for (const q of questoes) {
    if (q.temFigura) {
      const numMatch = q.numero.match(/\d+/);
      const numStr = numMatch ? numMatch[0] : q.id;
      const yearMatch = q.numero.match(/20\d{2}/);
      const year = yearMatch ? yearMatch[0] : '2025';
      
      if (q.figurasBase64 && q.figurasBase64.length > 0) {
        for (let index = 0; index < q.figurasBase64.length; index++) {
          const figBase64 = q.figurasBase64[index];
          try {
            console.log(`[ZIP Export] Convertendo figura ${index + 1} da Questão ${numStr} de PDF para PNG...`);
            const pngBase64 = await convertPdfBase64ToPngBase64(figBase64);
            const filename = `figura_questao_${numStr}_fig${index + 1}_${year}.png`;
            zip.file(`imagens/${filename}`, pngBase64, { base64: true });
          } catch (err) {
            console.error(`[ZIP Export] Falha na conversão para PNG da figura ${index + 1} da Questão ${numStr}. Salvando como PDF:`, err);
            const filename = `figura_questao_${numStr}_fig${index + 1}_${year}.pdf`;
            zip.file(`imagens/${filename}`, figBase64, { base64: true });
          }
        }
      } else if (q.figuraBase64) {
        try {
          console.log(`[ZIP Export] Convertendo figura única da Questão ${numStr} de PDF para PNG...`);
          const pngBase64 = await convertPdfBase64ToPngBase64(q.figuraBase64);
          const filename = `figura_questao_${numStr}_${year}.png`;
          zip.file(`imagens/${filename}`, pngBase64, { base64: true });
        } catch (err) {
          console.error(`[ZIP Export] Falha na conversão para PNG da figura única da Questão ${numStr}. Salvando como PDF:`, err);
          const filename = `figura_questao_${numStr}_${year}.pdf`;
          zip.file(`imagens/${filename}`, q.figuraBase64, { base64: true });
        }
      }
    }
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

/**
 * Gera um único arquivo .tex contendo todas as questões agrupadas e ordenadas por seus respectivos temas.
 */
export function generateConsolidatedLatexFile(
  questoes: QuestaoFísica[],
  options: LatexExportOptions = { includeComments: true }
): string {
  const header = [
    `% =============================================================`,
    `% LISTA COMPLETA DE QUESTÕES DE FÍSICA DO ENEM`,
    `% Total de questões: ${questoes.length}`,
    `% Gerado automaticamente pelo EnemFísica`,
    `% =============================================================\n`
  ].join('\n');

  // Group by theme
  const agrupado: Record<string, QuestaoFísica[]> = {};
  for (const q of questoes) {
    const tema = q.tema || 'Geral';
    if (!agrupado[tema]) {
      agrupado[tema] = [];
    }
    agrupado[tema].push(q);
  }

  const sections: string[] = [];
  for (const [tema, items] of Object.entries(agrupado)) {
    sections.push(`% -------------------------------------------------------------`);
    sections.push(`% SEÇÃO: ${tema.toUpperCase()} (${items.length} questões)`);
    sections.push(`% -------------------------------------------------------------`);
    const questoesDoTema = items.map(q => questionToLatex(q, options)).join('\n\n');
    sections.push(questoesDoTema);
  }

  return `${header}\n${sections.join('\n\n')}\n`;
}
