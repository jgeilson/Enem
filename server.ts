/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { jsonrepair } from 'jsonrepair';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

// In-memory cache for extracted PDF page texts
// Key: SHA-256 fingerprint of the PDF file buffer
// Value: string[] of page text contents
const pdfPageTextCache = new Map<string, string[]>();

function calculateBufferHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Extract text from a PDF page-by-page safely
async function getPdfPagesText(fileBuffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const result = await parser.getText();
    const sortedPages = [...result.pages].sort((a, b) => a.num - b.num);
    return sortedPages.map(p => p.text || '');
  } finally {
    await parser.destroy();
  }
}

// Multer storage
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 45 * 1024 * 1024, // 45 MB limit
  }
});

// Gemini Client initialization
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    timeout: 60000,
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite'
];

async function callGeminiWithRetry(prompt: string, maxRetries = 2): Promise<string> {
  let lastError: any = null;
  for (const model of CANDIDATE_MODELS) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const resp: any = await ai.models.generateContent({
          model,
          contents: [{ text: prompt }],
          config: {
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
          }
        });
        const text = resp?.text || resp?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
        if (text.trim()) return text;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '');
        if (msg.includes('429') || msg.includes('Quota')) {
          break; // Switch to next model immediately on quota
        }
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError || new Error('Não foi possível obter resposta do classificador.');
}

function parseClassificationJson(rawInput: string): any[] {
  if (!rawInput || typeof rawInput !== 'string') return [];
  let cleaned = rawInput.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : (parsed.questions || [parsed]);
  } catch {
    try {
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);
      return Array.isArray(parsed) ? parsed : (parsed.questions || [parsed]);
    } catch (err) {
      console.warn('[JSON Parser] Erro ao interpretar resposta:', err);
      return [];
    }
  }
}

// Clean common ENEM page headers, footers and noise
function cleanEnemNoise(text: string): string {
  return text
    .replace(/CIÊNCIAS DA NATUREZA E SUAS TECNOLOGIAS[^\n]*/gi, '')
    .replace(/ENEM\s*20\d\d[^\n]*/gi, '')
    .replace(/LC\s*-\s*2[º°]\s*dia\s*\|\s*Caderno[^\n]*/gi, '')
    .replace(/\*02\d{6,}\*/g, '')
    .replace(/Página\s+\d+/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface ExtractedQuestion {
  id: string;
  numero: string;
  reqNum: number;
  enunciado: string;
  alternativas: { letra: string; texto: string }[];
  temFigura: boolean;
  paginaIdx: number;
  tema: string | null;
  subtema: string;
  figurasBase64?: string[];
  figuraBase64?: string;
  temCincoAlternativas: boolean;
}

// 1. Processamento Local: Localizar, separar e estruturar questão + alternativas a partir do texto do PDF
function parseQuestionLocally(orderedPages: string[], reqNum: number): ExtractedQuestion | null {
  // Regex to find which page the question starts on
  const regexHeader = new RegExp(`(?:QUESTÃO|Questão|Questao)\\s*(?:de\\s+)?(?:n[º°o]\\s*)?[:-–—]?\\s*${reqNum}\\b`, 'i');
  const regexLineStart = new RegExp(`(?:^|\\n)[ \t]*\\b${reqNum}\\b\\s*[\\.\\-–—\\)]`, 'i');

  let foundPageIdx = -1;
  for (let i = 0; i < orderedPages.length; i++) {
    const pageText = orderedPages[i] || '';
    if (regexHeader.test(pageText) || regexLineStart.test(pageText)) {
      foundPageIdx = i;
      break;
    }
  }

  if (foundPageIdx === -1) {
    return null;
  }

  // Combine current page with next page to handle questions that cross page borders
  const combinedText = [
    orderedPages[foundPageIdx] || '',
    orderedPages[foundPageIdx + 1] || ''
  ].join('\n\n');

  // Locate the beginning of this question
  let startIdx = -1;
  const matchH = combinedText.match(new RegExp(`(?:QUESTÃO|Questão|Questao)\\s*(?:de\\s+)?(?:n[º°o]\\s*)?[:-–—]?\\s*${reqNum}\\b[^\n]*\n?`, 'i'));
  if (matchH && matchH.index !== undefined) {
    startIdx = matchH.index + matchH[0].length;
  } else {
    const matchL = combinedText.match(new RegExp(`(?:^|\\n)[ \t]*\\b${reqNum}\\b\\s*[\\.\\-–—\\)][^\n]*\n?`, 'i'));
    if (matchL && matchL.index !== undefined) {
      startIdx = matchL.index + matchL[0].length;
    }
  }

  if (startIdx === -1) {
    return null;
  }

  const textFromStart = combinedText.slice(startIdx);

  // Stop at the header of the next question
  const nextQMatch = textFromStart.match(/(?:^|\n)\s*(?:QUESTÃO|Questão|Questao)\s*(?:de\\s+)?(?:n[º°o]\\s*)?[:-–—]?\s*\d+\b/i);
  const rawQText = nextQMatch && nextQMatch.index !== undefined
    ? textFromStart.slice(0, nextQMatch.index)
    : textFromStart;

  // Search for the 5 alternatives: A, B, C, D, E
  // Support both line starts (e.g. \nA) and inline letter markers (e.g. A), (A), A.)
  let posA = rawQText.search(/(?:^|\n)\s*[A]\s*[\)\.\-–—\s]/);
  let posB = rawQText.search(/(?:^|\n)\s*[B]\s*[\)\.\-–—\s]/);
  let posC = rawQText.search(/(?:^|\n)\s*[C]\s*[\)\.\-–—\s]/);
  let posD = rawQText.search(/(?:^|\n)\s*[D]\s*[\)\.\-–—\s]/);
  let posE = rawQText.search(/(?:^|\n)\s*[E]\s*[\)\.\-–—\s]/);

  if (posA === -1 || posB === -1 || posC === -1 || posD === -1 || posE === -1 ||
      !(posA < posB && posB < posC && posC < posD && posD < posE)) {
    // Secondary search for inline alternatives format: (A) ... (B) ...
    posA = rawQText.search(/(?:^|\s)(?:[A][\)\.\-–—]|\([A]\))\s*/);
    posB = rawQText.search(/(?:^|\s)(?:[B][\)\.\-–—]|\([B]\))\s*/);
    posC = rawQText.search(/(?:^|\s)(?:[C][\)\.\-–—]|\([C]\))\s*/);
    posD = rawQText.search(/(?:^|\s)(?:[D][\)\.\-–—]|\([D]\))\s*/);
    posE = rawQText.search(/(?:^|\s)(?:[E][\)\.\-–—]|\([E]\))\s*/);
  }

  let enunciado = '';
  const alternativas: { letra: string; texto: string }[] = [];
  let temCincoAlternativas = false;

  if (posA !== -1 && posB !== -1 && posC !== -1 && posD !== -1 && posE !== -1 &&
      posA < posB && posB < posC && posC < posD && posD < posE) {
    enunciado = cleanEnemNoise(rawQText.slice(0, posA));
    const altA = cleanEnemNoise(rawQText.slice(posA, posB).replace(/^(?:^|\s|\n)*(?:[A]\s*[\)\.\-–—\s]|\([A]\))\s*/i, ''));
    const altB = cleanEnemNoise(rawQText.slice(posB, posC).replace(/^(?:^|\s|\n)*(?:[B]\s*[\)\.\-–—\s]|\([B]\))\s*/i, ''));
    const altC = cleanEnemNoise(rawQText.slice(posC, posD).replace(/^(?:^|\s|\n)*(?:[C]\s*[\)\.\-–—\s]|\([C]\))\s*/i, ''));
    const altD = cleanEnemNoise(rawQText.slice(posD, posE).replace(/^(?:^|\s|\n)*(?:[D]\s*[\)\.\-–—\s]|\([D]\))\s*/i, ''));
    const altE = cleanEnemNoise(rawQText.slice(posE).replace(/^(?:^|\s|\n)*(?:[E]\s*[\)\.\-–—\s]|\([E]\))\s*/i, ''));

    alternativas.push({ letra: 'A', texto: altA });
    alternativas.push({ letra: 'B', texto: altB });
    alternativas.push({ letra: 'C', texto: altC });
    alternativas.push({ letra: 'D', texto: altD });
    alternativas.push({ letra: 'E', texto: altE });

    temCincoAlternativas = alternativas.every(a => a.texto.trim().length > 0);
  } else {
    // If alternatives cannot be separated strictly by regex, capture raw text as enunciado
    enunciado = cleanEnemNoise(rawQText);
    ['A', 'B', 'C', 'D', 'E'].forEach(letra => {
      alternativas.push({ letra, texto: '' });
    });
  }

  // Detect figures/images in question text
  const temFigura = /(?:figura|gr[aá]fico|tabela|esquema|tirinha|charge|imagem|ilustra[çc][aã]o|ilustrad[ao]|veja o desenho|quadro|diagrama)/i.test(enunciado);

  return {
    id: `q-${reqNum}-${Date.now()}`,
    numero: `Questão ${reqNum} (ENEM)`,
    reqNum,
    enunciado,
    alternativas,
    temFigura,
    paginaIdx: foundPageIdx,
    tema: null,
    subtema: 'Geral',
    temCincoAlternativas
  };
}

// 2. IA exclusivamente para classificação temática (Tema e Subtema de Física)
async function classifyQuestionsWithAI(
  questions: { numero: string; enunciado: string }[]
): Promise<Map<string, { tema: string | null; subtema: string }>> {
  const map = new Map<string, { tema: string | null; subtema: string }>();
  if (questions.length === 0) return map;

  const prompt = `Classifique cada questão do ENEM nos seguintes temas de Física:
- "Mecânica"
- "Eletricidade e Magnetismo"
- "Termologia"
- "Óptica"
- "Ondulatória"
- "Física Moderna"

IMPORTANTE: Se a questão for de Química, Biologia ou outra matéria que não seja Física, responda com "tema": null.

Responda exclusivamente em formato JSON:
[
  {
    "numero": "Questão XX (ENEM)",
    "tema": "Mecânica",
    "subtema": "Cinemática"
  }
]

QUESTÕES:
${questions.map(q => `--- ${q.numero} ---\n${q.enunciado.slice(0, 300)}`).join('\n\n')}`;

  try {
    const raw = await callGeminiWithRetry(prompt);
    const parsed = parseClassificationJson(raw);
    for (const item of parsed) {
      if (item && item.numero) {
        const numMatch = String(item.numero).match(/\d+/);
        const key = numMatch ? numMatch[0] : item.numero;
        map.set(key, {
          tema: item.tema || null,
          subtema: item.subtema || 'Geral'
        });
      }
    }
  } catch (err) {
    console.warn('[AI Classification] Falha na classificação por IA. Definindo valores padrão:', err);
  }

  return map;
}

// 3. Recorte local das figuras diretamente no PDF com pdf-lib e conversão para Base64
async function cropQuestionFigures(
  questions: ExtractedQuestion[],
  pdfBuffer: Buffer
) {
  let sourceDoc: PDFDocument | null = null;
  try {
    sourceDoc = await PDFDocument.load(pdfBuffer);
  } catch (err) {
    console.error('[Figure Cropper] Não foi possível abrir o PDF para recorte:', err);
    return;
  }

  const pageCount = sourceDoc.getPageCount();

  for (const q of questions) {
    if (!q.temFigura) continue;
    if (q.paginaIdx < 0 || q.paginaIdx >= pageCount) continue;

    try {
      const croppedDoc = await PDFDocument.create();
      const [copiedPage] = await croppedDoc.copyPages(sourceDoc, [q.paginaIdx]);
      croppedDoc.addPage(copiedPage);

      const mediaBox = copiedPage.getMediaBox();
      const viewBox = copiedPage.getCropBox() || mediaBox;

      // Crop upper-middle area where ENEM figures usually sit
      const margin = 20;
      const cropX = Math.max(viewBox.x, viewBox.x + margin);
      const cropY = Math.max(viewBox.y, viewBox.y + (viewBox.height * 0.15));
      const cropWidth = Math.min(viewBox.width - (2 * margin), viewBox.width);
      const cropHeight = Math.min(viewBox.height * 0.70, viewBox.height);

      copiedPage.setMediaBox(cropX, cropY, cropWidth, cropHeight);
      copiedPage.setCropBox(cropX, cropY, cropWidth, cropHeight);

      const croppedBytes = await croppedDoc.save();
      const base64 = Buffer.from(croppedBytes).toString('base64');
      q.figurasBase64 = [base64];
      q.figuraBase64 = base64;
    } catch (cropErr) {
      console.warn(`[Figure Cropper] Falha ao recortar figura da Questão ${q.reqNum}:`, cropErr);
    }
  }
}

// Endpoint de Extração & Classificação
app.post('/api/classify', upload.single('pdfFile'), async (req, res) => {
  const { examText } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo PDF da prova do ENEM foi enviado.' });
  }

  if (!examText || !examText.trim()) {
    try { await fs.promises.unlink(file.path); } catch {}
    return res.status(400).json({ error: 'Informe ao menos um número de questão a ser extraída (ex: 95, 112).' });
  }

  const startTime = Date.now();

  try {
    const fullPdfBuffer = await fs.promises.readFile(file.path);
    const pdfHash = calculateBufferHash(fullPdfBuffer);

    // 1. Obter e armazenar texto das páginas em cache
    let orderedPages: string[] = [];
    if (pdfPageTextCache.has(pdfHash)) {
      orderedPages = pdfPageTextCache.get(pdfHash)!;
    } else {
      orderedPages = await getPdfPagesText(fullPdfBuffer);
      pdfPageTextCache.set(pdfHash, orderedPages);
      if (pdfPageTextCache.size > 30) {
        const oldestKey = pdfPageTextCache.keys().next().value;
        if (oldestKey) pdfPageTextCache.delete(oldestKey);
      }
    }

    // 2. Localizar números de questões
    const requestedNumbers = examText
      .split(/[\s,;]+/)
      .map((s: string) => parseInt(s.trim(), 10))
      .filter((n: number) => !isNaN(n));

    if (requestedNumbers.length === 0) {
      return res.status(400).json({ error: 'Nenhum número válido de questão foi identificado.' });
    }

    // 3. Processamento Local: Separar e estruturar questões
    const extractedList: ExtractedQuestion[] = [];
    const missingNumbers: number[] = [];

    for (const reqNum of requestedNumbers) {
      const parsed = parseQuestionLocally(orderedPages, reqNum);
      if (parsed) {
        extractedList.push(parsed);
      } else {
        missingNumbers.push(reqNum);
      }
    }

    console.log(`[Processamento Local] ${extractedList.length}/${requestedNumbers.length} questões separadas com sucesso.`);

    // 4. Classificação com IA (Apenas Tema e Subtema)
    if (extractedList.length > 0) {
      const classificationMap = await classifyQuestionsWithAI(
        extractedList.map(q => ({ numero: q.numero, enunciado: q.enunciado }))
      );

      for (const q of extractedList) {
        const cls = classificationMap.get(String(q.reqNum));
        if (cls) {
          q.tema = cls.tema;
          q.subtema = cls.subtema;
        } else {
          q.tema = 'Mecânica';
          q.subtema = 'Geral';
        }
      }
    }

    // 5. Recorte Local das Figuras
    await cropQuestionFigures(extractedList, fullPdfBuffer);

    const totalTime = ((Date.now() - startTime) / 1000);

    return res.json({
      questions: extractedList,
      missing: missingNumbers,
      performance: {
        total: totalTime
      }
    });

  } catch (error: any) {
    console.error('[API Classify Error]:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao processar as questões do ENEM.' });
  } finally {
    if (file && file.path) {
      fs.promises.unlink(file.path).catch(() => {});
    }
  }
});

// Serve frontend assets in production or Vite in dev
if (process.env.NODE_ENV === 'production' || process.env.VITE_PROD === 'true') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: false,
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
