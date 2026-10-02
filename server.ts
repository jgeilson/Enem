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
    timeout: 10000,
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const CANDIDATE_MODELS = [  
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];

async function callGeminiWithRetry(prompt: string): Promise<string> {
  let lastError: any = null;
  const deadline = Date.now() + 14000; // max 14s total budget for AI classification

  for (const model of CANDIDATE_MODELS) {
    if (Date.now() > deadline) break;
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
      // Move immediately to next candidate model without stalling
      continue;
    }
  }
  throw lastError || new Error('Não foi possível obter resposta do classificador dentro do tempo limite.');
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
    .replace(/(?:LC|CN|CH|MT)\s*-\s*\d[º°]\s*dia\s*\|\s*Caderno[^\n]*/gi, '')
    .replace(/\*02\d{6,}\*/g, '')
    .replace(/Página\s+\d+/gi, '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Clean and normalize text of an alternative
function cleanAlternativeText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/^\s*\(?[A-Ea-e]\)?\s*[\)\.\-–—\]:]*\s*/i, '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/CIÊNCIAS DA NATUREZA[^\n]*/gi, '')
    .replace(/ENEM\s*20\d\d[^\n]*/gi, '')
    .replace(/(?:LC|CN|CH|MT)\s*-\s*\d[º°]\s*dia[^\n]*/gi, '')
    .replace(/Página\s+\d+/gi, '')
    .replace(/\n+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Multi-strategy detection for alternatives A, B, C, D, E in ENEM text using sequence scan
function findAlternativePositions(rawQText: string): { posA: number; posB: number; posC: number; posD: number; posE: number } | null {
  const isValid = (a: number, b: number, c: number, d: number, e: number) =>
    a !== -1 && b !== -1 && c !== -1 && d !== -1 && e !== -1 &&
    a < b && b < c && c < d && d < e;

  const patterns = [
    /(?:^|\n|\s+)\(?([A-E])\)?\s*[\)\.\-–—\]:]\s*/gi,
    /(?:^|\n)\s*([A-E])\s+/gi,
    /\b([A-E])\s*[\)\.\-–—\]:]\s*/gi
  ];

  for (const pattern of patterns) {
    const matches: { letter: string; index: number }[] = [];
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(rawQText)) !== null) {
      const letter = (match[1] || '').toUpperCase();
      if (['A', 'B', 'C', 'D', 'E'].includes(letter)) {
        if (matches.length === 0 || matches[matches.length - 1].letter !== letter) {
          matches.push({ letter, index: match.index });
        }
      }
    }

    for (let i = 0; i <= matches.length - 5; i++) {
      if (
        matches[i].letter === 'A' &&
        matches[i+1].letter === 'B' &&
        matches[i+2].letter === 'C' &&
        matches[i+3].letter === 'D' &&
        matches[i+4].letter === 'E'
      ) {
        const posA = matches[i].index;
        const posB = matches[i+1].index;
        const posC = matches[i+2].index;
        const posD = matches[i+3].index;
        const posE = matches[i+4].index;
        if (isValid(posA, posB, posC, posD, posE)) {
          return { posA, posB, posC, posD, posE };
        }
      }
    }
  }

  return null;
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
  const regexHeader = new RegExp(`(?:QUESTÃO|Questão|Questao)\\s*(?:de\\s+)?(?:n[º°o]\\s*)?[:-–—]?\\s*${reqNum}\\b[^\n]*\n?`, 'i');
  const regexLineStart = new RegExp(`(?:^|\\n)[ \t]*\\b${reqNum}\\b\\s*[\\.\\-–—\\)][^\n]*\n?`, 'i');

  let foundPageIdx = -1;
  let startIdxInPage = -1;

  for (let i = 0; i < orderedPages.length; i++) {
    const pageText = orderedPages[i] || '';
    const matchH = pageText.match(regexHeader);
    if (matchH && matchH.index !== undefined) {
      foundPageIdx = i;
      startIdxInPage = matchH.index + matchH[0].length;
      break;
    }
    const matchL = pageText.match(regexLineStart);
    if (matchL && matchL.index !== undefined) {
      foundPageIdx = i;
      startIdxInPage = matchL.index + matchL[0].length;
      break;
    }
  }

  if (foundPageIdx === -1 || startIdxInPage === -1) {
    return null;
  }

  // Regex that identifies the beginning of the next question
  const regexNextQ = /(?:^|\n)\s*(?:QUESTÃO|Questão|Questao)\s*(?:de\s+)?(?:n[º°o]\s*)?[:-–—]?\s*\d+\b/i;

  // Dynamic Page-Walking: Continuously read through pages until the next question header is found
  let accumulatedText = '';
  const firstPageContent = (orderedPages[foundPageIdx] || '').slice(startIdxInPage);
  const nextQInFirstPage = firstPageContent.match(regexNextQ);

  let figurePageIdx = foundPageIdx;
  const figRegex = /(?:figuras?|gr[aá]ficos?|curvas?|tabelas?|quadros?|esquemas?|esquematizad[ao]s?|diagramas?|circuitos?|desenhos?|tirinhas?|charges?|imagens?|fotografias?|fotos?|ilustra[çc][aã]o|ilustra[çc][oõ]es|ilustrad[ao]s?|como\s+(?:mostr[ao]|ilustrad[ao])|representad[ao]|arranjo\s+experimental|aparato\s+experimental|dispositivo|dispon[íi]vel\s+em|acesso\s+em|adaptado\s+de|fonte\s*:|reprodu[çc][aã]o|cr[eé]dito|fotoc[oó]pia)/i;

  if (nextQInFirstPage && nextQInFirstPage.index !== undefined) {
    // The next question starts on the very same page
    accumulatedText = firstPageContent.slice(0, nextQInFirstPage.index);
  } else {
    accumulatedText = firstPageContent;

    // Continue walking through subsequent pages
    for (let p = foundPageIdx + 1; p < orderedPages.length; p++) {
      const pageText = orderedPages[p] || '';
      const nextQInPage = pageText.match(regexNextQ);

      // If figure cue is found on this subsequent page, update figurePageIdx
      if (!figRegex.test(firstPageContent) && figRegex.test(pageText)) {
        figurePageIdx = p;
      }

      if (nextQInPage && nextQInPage.index !== undefined) {
        // Next question found on page p: append content up to its header and stop
        accumulatedText += '\n\n' + pageText.slice(0, nextQInPage.index);
        break;
      } else {
        // Next question not yet found: include entire page p and continue to page p + 1
        accumulatedText += '\n\n' + pageText;
        if (p - foundPageIdx >= 4) {
          break; // Safety limit
        }
      }
    }
  }

  const rawQText = accumulatedText;

  // Search for the 5 alternatives: A, B, C, D, E using multi-strategy detection
  const positions = findAlternativePositions(rawQText);

  let enunciado = '';
  const alternativas: { letra: string; texto: string }[] = [];
  let temCincoAlternativas = false;

  if (positions) {
    const { posA, posB, posC, posD, posE } = positions;
    enunciado = cleanEnemNoise(rawQText.slice(0, posA));

    const altA = cleanAlternativeText(rawQText.slice(posA, posB));
    const altB = cleanAlternativeText(rawQText.slice(posB, posC));
    const altC = cleanAlternativeText(rawQText.slice(posC, posD));
    const altD = cleanAlternativeText(rawQText.slice(posD, posE));
    const altE = cleanAlternativeText(rawQText.slice(posE));

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

  // Detect figures/images in question text or in alternatives (e.g. graphical options)
  const alternativasSaoGraficas = enunciado.match(/gr[aá]fico\s+que\s+(?:melhor\s+)?representa|esquema\s+que\s+(?:melhor\s+)?representa|curva\s+que\s+representa/i) !== null;
  const temFigura = figRegex.test(enunciado) || alternativasSaoGraficas || (alternativas.length === 5 && alternativas.some(a => a.texto.trim().length === 0));

  return {
    id: `q-${reqNum}-${Date.now()}`,
    numero: `Questão ${reqNum} (ENEM)`,
    reqNum,
    enunciado,
    alternativas,
    temFigura,
    paginaIdx: figurePageIdx,
    tema: null,
    subtema: 'Não classificado',
    temCincoAlternativas
  };
}

// 2. IA exclusivamente para classificação temática (Tema e Subtema de Física)
async function classifyQuestionsWithAI(
  questions: { numero: string; enunciado: string; alternativas: { letra: string; texto: string }[] }[]
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

DIRETRIZES:
1. Analise o ENUNCIADO COMPLETO e as ALTERNATIVAS (que contêm grandezas, unidades e fórmulas cruciais).
2. Se a questão for de Química, Biologia, Matemática ou outra matéria que não seja Física, responda estritamente com "tema": null.
3. Indique o subtema específico da Física (ex: Cinemática, Dinâmica, Eletrostática, Circuitos, Calorimetria, Efeito Doppler, Óptica Geométrica, etc.).

Responda exclusivamente em formato JSON:
[
  {
    "numero": "Questão XX (ENEM)",
    "tema": "Mecânica",
    "subtema": "Cinemática"
  }
]

QUESTÕES:
${questions.map(q => {
  const safeEnunciado = q.enunciado.slice(0, 4000);
  const altsText = (q.alternativas || [])
    .filter(a => a && a.texto && a.texto.trim())
    .map(a => `${a.letra}) ${a.texto}`)
    .join('\n');

  return `--- ${q.numero} ---
ENUNCIADO:
${safeEnunciado}

ALTERNATIVAS:
${altsText || '(Alternativas não identificadas)'}`;
}).join('\n\n')}`;

  try {
    const raw = await callGeminiWithRetry(prompt);
    const parsed = parseClassificationJson(raw);
    for (const item of parsed) {
      if (item && item.numero) {
        const numMatch = String(item.numero).match(/\d+/);
        const key = numMatch ? numMatch[0] : item.numero;
        map.set(key, {
          tema: item.tema || null,
          subtema: item.subtema || (item.tema ? 'Geral' : 'Não classificado')
        });
      }
    }
  } catch (err) {
    console.warn('[AI Classification] Falha na classificação por IA. Definindo valores padrão:', err);
  }

  return map;
}

// 3. Processamento de Figuras: Produção determinística via 3 abordagens
// Abordagem 1: Delimitação Geométrica por Coluna (Bounding Box do ENEM)
// Abordagem 2: Recorte Focalizado da Área Central da Figura
// Abordagem 3: Fallback - Página Inteira da Questão (preservação garantida)

function getQuestionPageGeometry(pageText: string, reqNum: number) {
  const regexHeader = new RegExp(`(?:QUESTÃO|Questão|Questao)\\s*(?:de\\s+)?(?:n[º°o]\\s*)?[:-–—]?\\s*${reqNum}\\b`, 'i');
  const regexLineStart = new RegExp(`(?:^|\\n)[ \t]*\\b${reqNum}\\b\\s*[\\.\\-–—\\)]`, 'i');

  const matchH = pageText.match(regexHeader);
  const matchL = pageText.match(regexLineStart);
  const matchIdx = matchH?.index ?? matchL?.index ?? 0;

  // In ENEM 2-column layout, column 1 text comes first, column 2 second
  const isRightColumn = matchIdx > (pageText.length * 0.48);
  const colTextLength = Math.max(pageText.length * 0.52, 1);
  const posInCol = isRightColumn
    ? (matchIdx - (pageText.length * 0.48)) / colTextLength
    : matchIdx / colTextLength;

  const isUpperHalf = posInCol < 0.45;

  return { isRightColumn, isUpperHalf };
}

// Abordagem 1: Delimitação Geométrica por Coluna
async function cropColumnFigure(
  sourceDoc: PDFDocument,
  paginaIdx: number,
  isRightColumn: boolean,
  isUpperHalf: boolean
): Promise<string | null> {
  try {
    const croppedDoc = await PDFDocument.create();
    const [copiedPage] = await croppedDoc.copyPages(sourceDoc, [paginaIdx]);
    croppedDoc.addPage(copiedPage);

    const mediaBox = copiedPage.getMediaBox();
    const W = mediaBox.width;
    const H = mediaBox.height;

    // Standard ENEM geometry: 2 columns with central gutter
    const marginSide = 22;
    const gutter = 16;
    const colWidth = (W - (2 * marginSide) - gutter) / 2; // ~265 pt

    const colX = isRightColumn
      ? mediaBox.x + marginSide + colWidth + gutter
      : mediaBox.x + marginSide;

    const topMargin = 50; // avoids header text "CIÊNCIAS DA NATUREZA..."
    const bottomMargin = 45; // avoids footer text "Página X..."
    const usableH = H - topMargin - bottomMargin;

    let cropY = mediaBox.y + bottomMargin;
    let cropH = usableH;

    if (isUpperHalf) {
      cropY = mediaBox.y + bottomMargin + (usableH * 0.38);
      cropH = usableH * 0.62;
    } else {
      cropY = mediaBox.y + bottomMargin;
      cropH = usableH * 0.62;
    }

    copiedPage.setMediaBox(colX, cropY, colWidth, cropH);
    copiedPage.setCropBox(colX, cropY, colWidth, cropH);

    const bytes = await croppedDoc.save({ useObjectStreams: true });
    return Buffer.from(bytes).toString('base64');
  } catch (err) {
    console.warn('[Abordagem 1 - Coluna] Falha:', err);
    return null;
  }
}

// Abordagem 2: Recorte Focalizado da Área Central da Figura
async function cropFocusedFigure(
  sourceDoc: PDFDocument,
  paginaIdx: number,
  isRightColumn: boolean,
  isUpperHalf: boolean
): Promise<string | null> {
  try {
    const croppedDoc = await PDFDocument.create();
    const [copiedPage] = await croppedDoc.copyPages(sourceDoc, [paginaIdx]);
    croppedDoc.addPage(copiedPage);

    const mediaBox = copiedPage.getMediaBox();
    const W = mediaBox.width;
    const H = mediaBox.height;

    const marginSide = 22;
    const gutter = 16;
    const colWidth = (W - (2 * marginSide) - gutter) / 2;

    const colX = isRightColumn
      ? mediaBox.x + marginSide + colWidth + gutter
      : mediaBox.x + marginSide;

    const topMargin = 50;
    const bottomMargin = 45;
    const usableH = H - topMargin - bottomMargin;

    // Tighter focal window on figure center:
    // width: 94% of column, height: ~250pt centered in question body
    const tightW = colWidth * 0.94;
    const tightX = colX + (colWidth - tightW) / 2;
    const tightH = Math.min(usableH * 0.42, 270);

    let tightY = mediaBox.y + bottomMargin;
    if (isUpperHalf) {
      tightY = mediaBox.y + bottomMargin + (usableH * 0.48);
    } else {
      tightY = mediaBox.y + bottomMargin + (usableH * 0.12);
    }

    copiedPage.setMediaBox(tightX, tightY, tightW, tightH);
    copiedPage.setCropBox(tightX, tightY, tightW, tightH);

    const bytes = await croppedDoc.save({ useObjectStreams: true });
    return Buffer.from(bytes).toString('base64');
  } catch (err) {
    console.warn('[Abordagem 2 - Focalizada] Falha:', err);
    return null;
  }
}

// Abordagem 3: Fallback - Página Inteira da Questão
async function cropFullPage(
  sourceDoc: PDFDocument,
  paginaIdx: number
): Promise<string | null> {
  try {
    const fullDoc = await PDFDocument.create();
    const [copiedPage] = await fullDoc.copyPages(sourceDoc, [paginaIdx]);
    fullDoc.addPage(copiedPage);

    const bytes = await fullDoc.save({ useObjectStreams: true });
    return Buffer.from(bytes).toString('base64');
  } catch (err) {
    console.warn('[Abordagem 3 - Página Inteira] Falha:', err);
    return null;
  }
}

async function cropQuestionFigures(
  questions: ExtractedQuestion[],
  pdfBuffer: Buffer,
  orderedPages: string[]
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

    const pageText = orderedPages[q.paginaIdx] || '';
    const { isRightColumn, isUpperHalf } = getQuestionPageGeometry(pageText, q.reqNum);

    const candidates: string[] = [];

    // Abordagem 1: Delimitação Geométrica por Coluna (Bounding Box)
    const colCrop = await cropColumnFigure(sourceDoc, q.paginaIdx, isRightColumn, isUpperHalf);
    if (colCrop) {
      candidates.push(colCrop);
    }

    // Abordagem 2: Recorte Focalizado da Área Central da Figura
    const focusedCrop = await cropFocusedFigure(sourceDoc, q.paginaIdx, isRightColumn, isUpperHalf);
    if (focusedCrop) {
      candidates.push(focusedCrop);
    }

    // Abordagem 3 (Fallback): Se ambas falharem, armazena a página inteira da questão
    if (candidates.length === 0) {
      console.log(`[Figure Cropper] Abordagens 1 e 2 falharam para Questão ${q.reqNum}. Armazenando Página Inteira (Fallback).`);
      const fullPage = await cropFullPage(sourceDoc, q.paginaIdx);
      if (fullPage) {
        candidates.push(fullPage);
      }
    }

    q.figurasBase64 = candidates;
    q.figuraBase64 = candidates[0] || undefined;
  }
}

// Endpoint de Extração & Classificação
app.post(['/api/classify', '/api/classify/'], upload.single('pdfFile'), async (req, res) => {
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
        extractedList.map(q => ({
          numero: q.numero,
          enunciado: q.enunciado,
          alternativas: q.alternativas
        }))
      );

      for (const q of extractedList) {
        const cls = classificationMap.get(String(q.reqNum));
        if (cls && cls.tema) {
          q.tema = cls.tema;
          q.subtema = cls.subtema || 'Geral';
        } else {
          q.tema = null;
          q.subtema = cls?.subtema && cls.subtema !== 'Geral' ? cls.subtema : 'Não classificado';
        }
      }
    }

    // 5. Recorte Local das Figuras (Abordagem 1, Abordagem 2 e Fallback)
    await cropQuestionFigures(extractedList, fullPdfBuffer, orderedPages);

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

// Express error handler to guarantee all API errors return JSON rather than HTML
app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Route Error]:', err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: err.code === 'LIMIT_FILE_SIZE' 
      ? 'O arquivo PDF excede o limite permitido de 45MB.' 
      : (err.message || 'Erro interno ao processar a requisição.')
  });
});

// Fallback for unknown /api routes so they return JSON 404 and NEVER fall through to Vite SPA index.html
app.all('/api/*', (req, res) => {
  return res.status(404).json({ error: `Rota de API não encontrada: ${req.method} ${req.originalUrl}` });
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
