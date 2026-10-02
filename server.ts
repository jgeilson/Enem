/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { jsonrepair } from 'jsonrepair';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

import crypto from 'crypto';

dotenv.config();

// In-memory cache for extracted PDF page texts
// Key: SHA-256 fingerprint of the PDF file buffer
// Value: string[] of page text contents
const pdfPageTextCache = new Map<string, string[]>();

function calculateBufferHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Helper to extract text from a PDF page-by-page safely using the custom PDFParse class API
async function getPdfPagesText(fileBuffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const result = await parser.getText();
    // Sort pages by page number (1-based index) ascending
    const sortedPages = [...result.pages].sort((a, b) => a.num - b.num);
    const orderedPages: string[] = sortedPages.map(p => p.text || '');
    return orderedPages;
  } finally {
    await parser.destroy();
  }
}

// Helper to extract specific page indexes and output a new PDF Buffer
async function extractSpecificPages(srcPdfBuffer: Buffer, pageIndexes: number[]): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(srcPdfBuffer);
  const destDoc = await PDFDocument.create();
  
  const sortedIndexes = [...pageIndexes].sort((a, b) => a - b);
  
  const copiedPages = await destDoc.copyPages(srcDoc, sortedIndexes);
  copiedPages.forEach((page) => destDoc.addPage(page));
  
  const pdfBytes = await destDoc.save();
  return Buffer.from(pdfBytes);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

// Configure multer disk storage to preserve the file extension
const storage = multer.diskStorage({
  destination: '/tmp/',
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.pdf');
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 45 * 1024 * 1024, // 45 MB limit
  }
});

// Custom body-parser error handler and multer error handler
app.use((err: any, req: any, res: any, next: any) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'O arquivo PDF enviado é grande demais (limite máximo de 45MB). Por favor, reduza o tamanho do PDF.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'O arquivo PDF enviado é grande demais (excede o limite de tamanho). Por favor, tente enviar um PDF menor ou copie o texto diretamente.' });
  }
  if (err) {
    return res.status(400).json({ error: 'Erro de formatação nos dados enviados. Por favor, tente novamente.' });
  }
  next();
});

// Set up Gemini client with extended timeout to handle large documents
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    timeout: 300000, // 5 minutes timeout for large documents
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Priority list of models to gracefully fallback if high-demand (503), quota (429) or connection resets occur
const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest'
];

/// Helper to execute Gemini calls with automatic exponential backoff for transient 503/high-demand errors,
/// network drops (fetch failed, ECONNRESET, ETIMEDOUT), and dynamic model fallbacks on 429 quota exhaustion.
async function generateContentWithRetry(aiClient: any, params: any, maxRetriesPerModel = 3) {
  let lastError: any = new Error('Falha ao obter resposta do Gemini após várias tentativas e modelos de fallback.');

  // Try each candidate model in order of reliability and availability
  for (const model of CANDIDATE_MODELS) {
    for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
      try {
        console.log(`[Gemini API] Executando chamada com o modelo '${model}' (tentativa ${attempt}/${maxRetriesPerModel})...`);
        const mergedParams = { ...params, model };
        const res = await aiClient.models.generateContent(mergedParams);
        
        const extractedText = res?.text || res?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
        if (!extractedText || extractedText.trim() === '' || extractedText.trim() === '[]') {
          console.warn(`[Gemini API] Modelo '${model}' retornou resposta vazia.`);
          throw new Error(`Modelo '${model}' retornou resposta vazia.`);
        }
        
        return res;
      } catch (error: any) {
        lastError = error;
        const errorMsg = String(error?.message || '');
        const errorStr = String(error);
        const causeCode = String(error?.cause?.code || '');

        const is429 = 
          error?.status === 429 || 
          error?.statusCode === 429 || 
          errorMsg.includes('429') || 
          errorMsg.includes('Quota exceeded') || 
          errorMsg.includes('RESOURCE_EXHAUSTED') ||
          errorStr.includes('429') || 
          errorStr.includes('RESOURCE_EXHAUSTED');

        const is503 = 
          error?.status === 503 || 
          error?.statusCode === 503 || 
          errorMsg.includes('503') || 
          errorMsg.includes('high demand') || 
          errorMsg.includes('UNAVAILABLE') ||
          errorMsg.includes('temporary') ||
          errorStr.includes('503') || 
          errorStr.includes('high demand') || 
          errorStr.includes('UNAVAILABLE');

        const isNetworkOrReset = 
          errorMsg.includes('fetch failed') ||
          errorMsg.includes('ECONNRESET') ||
          errorMsg.includes('ETIMEDOUT') ||
          errorMsg.includes('socket') ||
          errorMsg.includes('hang up') ||
          errorStr.includes('ECONNRESET') ||
          errorStr.includes('fetch failed') ||
          causeCode === 'ECONNRESET' ||
          causeCode === 'ETIMEDOUT' ||
          causeCode === 'UND_ERR_SOCKET';

        console.warn(`[Gemini API] Falha no modelo '${model}' na tentativa ${attempt}: ${errorMsg || errorStr}`);

        // If it's a 429 hard quota exhaustion (e.g. daily limit 0 or full quota exhausted), switch models immediately instead of sleeping
        const isHardQuota = is429 && (errorMsg.includes('limit: 0') || errorMsg.includes('limit: 20') || errorMsg.includes('PerDay'));
        if (isHardQuota) {
          console.warn(`[Gemini API] Cota diária/por minuto esgotada no modelo '${model}'. Alternando imediatamente para o próximo modelo/fallback...`);
          break;
        }

        // If it's a recoverable transient error (503, temporary rate limit, or network drop) and we have retries remaining:
        if (is503 || is429 || isNetworkOrReset) {
          if (attempt < maxRetriesPerModel) {
            const baseWaitMs = Math.pow(1.5, attempt) * 1000;
            const jitter = Math.random() * 500;
            const waitTimeMs = baseWaitMs + jitter;
            
            console.log(`[Gemini API] Erro recobertável (${is503 ? '503' : is429 ? '429' : 'Rede'}). Aguardando ${Math.round(waitTimeMs)}ms antes de tentar novamente...`);
            await new Promise(resolve => setTimeout(resolve, waitTimeMs));
          } else {
            console.warn(`[Gemini API] Limite de tentativas esgotado para o modelo '${model}'. Alternando para o próximo candidato...`);
          }
        } else {
          console.warn(`[Gemini API] Erro não-recuperável no modelo '${model}'. Alternando de modelo...`);
          break;
        }
      }
    }
  }

  throw lastError;
}

async function getGroqLiveModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        // Filter strictly to standard general LLMs (Meta Llama, Gemma, Mixtral, Qwen, DeepSeek)
        // and eliminate specialized/gated models that require separate terms or aren't standard text LLMs
        const ids: string[] = json.data
          .map((m: any) => m.id)
          .filter((id: string) => {
            const lower = id.toLowerCase();
            if (
              lower.includes('whisper') ||
              lower.includes('tts') ||
              lower.includes('embed') ||
              lower.includes('guard') ||
              lower.includes('canopy') ||
              lower.includes('orpheus') ||
              lower.includes('allam') ||
              lower.includes('arabic') ||
              lower.includes('vision') ||
              lower.includes('audio') ||
              lower.includes('speech') ||
              lower.includes('specdec') ||
              lower.includes('prompt-guard')
            ) {
              return false;
            }
            return (
              lower.includes('llama') ||
              lower.includes('gemma') ||
              lower.includes('mixtral') ||
              lower.includes('qwen') ||
              lower.includes('deepseek')
            );
          });
        
        // Priority sorting: llama-3.1-8b-instant and llama-3.3-70b have the highest rate limits and best reliability on Groq
        const prioritized = ids.sort((a, b) => {
          const score = (name: string) => {
            const lower = name.toLowerCase();
            if (lower.includes('llama-3.1-8b-instant') || lower === 'llama-3.1-8b-instant') return 120;
            if (lower.includes('llama-3.3-70b-versatile') || lower === 'llama-3.3-70b-versatile') return 110;
            if (lower.includes('llama-3.1-70b-versatile') || lower === 'llama-3.1-70b-versatile') return 100;
            if (lower.includes('llama-3.2-3b')) return 90;
            if (lower.includes('llama-3.2-1b')) return 85;
            if (lower.includes('llama3-70b-8192')) return 80;
            if (lower.includes('llama3-8b-8192')) return 75;
            if (lower.includes('gemma2-9b-it')) return 70;
            if (lower.includes('mixtral')) return 50;
            if (lower.includes('qwen')) return 30; // Qwen has very low output token per minute limits on Groq free tier
            return 10;
          };
          return score(b) - score(a);
        });

        if (prioritized.length > 0) {
          console.log('[Groq API] Modelos LLM compatíveis detectados na sua conta:', prioritized);
          return prioritized;
        }
      }
    }
  } catch (err) {
    console.warn('[Groq API] Não foi possível obter a lista ao vivo de modelos da Groq:', err);
  }
  // Safe default fallback list if endpoint is unreachable
  return [
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "gemma2-9b-it"
  ];
}

async function callGroqWithRetry(apiKey: string, prompt: string): Promise<string> {
  const models = await getGroqLiveModels(apiKey);
  let lastError: any = null;
  
  for (const model of models) {
    try {
      console.log(`[Groq API] Executando com o modelo '${model}'...`);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: 'Você é um assistente especialista que extrai questões do ENEM e formata estritamente em JSON válido.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 3500,
          response_format: { type: 'json_object' }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[Groq API] Modelo '${model}' retornou erro (${res.status}): ${errText}`);
        lastError = new Error(`Erro na API do Groq (${res.status}): ${errText}`);
        continue;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (!content || content.trim() === '' || content.trim() === '[]') {
        console.warn(`[Groq API] Modelo '${model}' retornou conteúdo vazio.`);
        continue;
      }
      console.log(`[Groq API] Extração concluída com sucesso com o modelo '${model}'!`);
      return content;
    } catch (err) {
      console.warn(`[Groq API] Exceção ao chamar modelo '${model}':`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('Todos os modelos disponíveis no Groq falharam.');
}

async function getOpenRouterLiveModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://ais-pre-afoitbmb6m6fyxmrpcbhnu-213635603015.us-west2.run.app',
        'X-Title': 'ENEM LaTeX Classifier'
      }
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        // Collect active free models first
        const freeModels = json.data
          .filter((m: any) => {
            const isFree = m.id?.endsWith(':free') || (m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0');
            const isText = !m.id?.includes('whisper') && !m.id?.includes('embed') && !m.id?.includes('image');
            return isFree && isText;
          })
          .map((m: any) => m.id);

        // General popular models if user has credits
        const standardModels = json.data
          .filter((m: any) => !m.id?.includes('whisper') && !m.id?.includes('embed'))
          .map((m: any) => m.id);

        const allCandidates = Array.from(new Set([...freeModels, ...standardModels]));

        if (allCandidates.length > 0) {
          console.log('[OpenRouter API] Modelos ao vivo detectados na API:', freeModels.slice(0, 8));
          return allCandidates;
        }
      }
    }
  } catch (err) {
    console.warn('[OpenRouter API] Não foi possível consultar a lista ao vivo de modelos do OpenRouter:', err);
  }

  // Safe fallback list
  return [
    "meta-llama/llama-3.3-70b-instruct:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "meta-llama/llama-3.2-1b-instruct:free",
    "qwen/qwen-2.5-7b-instruct:free",
    "deepseek/deepseek-r1:free",
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.1-8b-instruct",
    "meta-llama/llama-3.3-70b-instruct"
  ];
}

async function callOpenRouter(apiKey: string, prompt: string): Promise<string> {
  const models = await getOpenRouterLiveModels(apiKey);
  let lastError: any = null;
  
  // Try up to 8 candidate models to prevent long hanging loops
  const candidateSlice = models.slice(0, 10);

  for (const model of candidateSlice) {
    try {
      console.log(`[OpenRouter API] Executando com o modelo '${model}'...`);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ais-pre-afoitbmb6m6fyxmrpcbhnu-213635603015.us-west2.run.app',
          'X-Title': 'ENEM LaTeX Classifier'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: 'Você é um assistente especialista que extrai questões do ENEM e formata estritamente em JSON válido.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[OpenRouter API] Modelo '${model}' retornou erro (${res.status}): ${errText}`);
        lastError = new Error(`Erro na API do OpenRouter (${res.status}): ${errText}`);
        continue;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      console.log(`[OpenRouter API] Extração concluída com sucesso com o modelo '${model}'!`);
      return content;
    } catch (err) {
      console.warn(`[OpenRouter API] Exceção ao chamar modelo '${model}':`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('Todos os modelos disponíveis no OpenRouter falharam.');
}

/// Helper to upload files to the Gemini Files API with automatic exponential backoff for transient errors
async function uploadFileWithRetry(aiClient: any, filePath: string, maxRetries = 3): Promise<any> {
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Gemini Files API] Fazendo upload do arquivo (Tentativa ${attempt}/${maxRetries})...`);
      const file = await aiClient.files.upload({
        file: filePath,
        config: {
          mimeType: "application/pdf"
        }
      });
      if (file && file.uri) {
        console.log(`[Gemini Files API] Upload concluído com sucesso. URI: ${file.uri}`);
        return file;
      }
      throw new Error("Resposta de upload inválida (URI vazia).");
    } catch (error: any) {
      lastError = error;
      const errorMsg = String(error?.message || '');
      const errorStr = String(error);
      const causeCode = String(error?.cause?.code || '');

      const is429 = 
        error?.status === 429 || 
        error?.statusCode === 429 || 
        errorMsg.includes('429') || 
        errorMsg.includes('Quota exceeded') || 
        errorMsg.includes('RESOURCE_EXHAUSTED') ||
        errorStr.includes('429') || 
        errorStr.includes('RESOURCE_EXHAUSTED');

      const is503 = 
        error?.status === 503 || 
        error?.statusCode === 503 || 
        errorMsg.includes('503') || 
        errorMsg.includes('high demand') || 
        errorMsg.includes('UNAVAILABLE') ||
        errorMsg.includes('temporary') ||
        errorStr.includes('503') || 
        errorStr.includes('high demand') || 
        errorStr.includes('UNAVAILABLE');

      const isNetworkOrReset = 
        errorMsg.includes('fetch failed') ||
        errorMsg.includes('ECONNRESET') ||
        errorMsg.includes('ETIMEDOUT') ||
        errorMsg.includes('socket') ||
        errorMsg.includes('hang up') ||
        errorStr.includes('ECONNRESET') ||
        errorStr.includes('fetch failed') ||
        causeCode === 'ECONNRESET' ||
        causeCode === 'ETIMEDOUT' ||
        causeCode === 'UND_ERR_SOCKET';

      console.warn(`[Gemini Files API] Falha no upload na tentativa ${attempt}: ${errorMsg || errorStr}`);

      if (is503 || is429 || isNetworkOrReset) {
        if (attempt < maxRetries) {
          const baseWaitMs = Math.pow(2.5, attempt) * 1000;
          const jitter = Math.random() * 1000;
          const waitTimeMs = baseWaitMs + jitter;
          console.log(`[Gemini Files API] Erro recobertável detectado durante o upload. Aplicando backoff exponencial: aguardando ${Math.round(waitTimeMs)}ms antes de tentar novamente...`);
          await new Promise(resolve => setTimeout(resolve, waitTimeMs));
        }
      } else {
        // Non-recoverable error during upload, fail immediately
        throw error;
      }
    }
  }
  
  throw lastError;
}

function normalizeQuestionsArray(parsed: any): any[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && Array.isArray(parsed.questions)) {
    return parsed.questions;
  }
  if (parsed && typeof parsed === 'object') {
    return [parsed];
  }
  return [];
}

/**
 * Ultra-robust 5-stage JSON parser and repair engine.
 * Specifically resilient against unescaped LaTeX backslashes, unescaped quotes,
 * truncated outputs, and markdown code fences.
 */
function parseAndRepairJson(rawInput: string): any[] {
  if (!rawInput || typeof rawInput !== 'string' || rawInput.trim() === '' || rawInput.trim() === '[]') {
    return [];
  }

  let cleaned = rawInput.trim();
  
  // 1. Remove markdown backticks if any
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  if (!cleaned || cleaned === '' || cleaned === '[]') {
    return [];
  }

  // 2. Find outermost bracket bounds [ ... ] or object bounds { ... }
  const firstBracket = cleaned.indexOf('[');
  const firstBrace = cleaned.indexOf('{');
  
  let startIndex = -1;
  let endIndex = -1;
  
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    startIndex = firstBracket;
    endIndex = cleaned.lastIndexOf(']');
  } else if (firstBrace !== -1) {
    startIndex = firstBrace;
    endIndex = cleaned.lastIndexOf('}');
  }
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    cleaned = cleaned.substring(startIndex, endIndex + 1);
  }

  // Stage 1: Standard zero-overhead JSON.parse
  try {
    const res = JSON.parse(cleaned);
    return normalizeQuestionsArray(res);
  } catch (err1) {
    // Continue to next stages
  }

  // Stage 2: jsonrepair standard pass
  try {
    const repaired = jsonrepair(cleaned);
    const res = JSON.parse(repaired);
    return normalizeQuestionsArray(res);
  } catch (err2) {
    console.warn('[JSON Repair Stage 2] jsonrepair inicial falhou:', err2);
  }

  // Stage 3: Escape lone backslashes that are not valid JSON escape sequences
  // In JSON, valid escapes are \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
  try {
    const escapedBackslashes = cleaned.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
    try {
      const res = JSON.parse(escapedBackslashes);
      return normalizeQuestionsArray(res);
    } catch {
      const repaired = jsonrepair(escapedBackslashes);
      const res = JSON.parse(repaired);
      return normalizeQuestionsArray(res);
    }
  } catch (err3) {
    console.warn('[JSON Repair Stage 3] Correção de barras invertidas LaTeX falhou:', err3);
  }

  // Stage 4: If truncated at the end, attempt to close open strings, objects and array
  try {
    let truncated = cleaned;
    const openBrackets = (truncated.match(/\[/g) || []).length;
    const closeBrackets = (truncated.match(/\]/g) || []).length;
    const openBraces = (truncated.match(/\{/g) || []).length;
    const closeBraces = (truncated.match(/\}/g) || []).length;
    
    // Add missing closing quotes if odd number of quotes
    const quoteMatches = truncated.match(/"/g) || [];
    if (quoteMatches.length % 2 !== 0) {
      truncated += '"';
    }
    for (let i = 0; i < openBraces - closeBraces; i++) {
      truncated += '}';
    }
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      truncated += ']';
    }
    const repaired = jsonrepair(truncated);
    const res = JSON.parse(repaired);
    return normalizeQuestionsArray(res);
  } catch (err4) {
    console.warn('[JSON Repair Stage 4] Tentativa de fechamento de JSON truncado falhou:', err4);
  }

  // Stage 5: Regex-based question block extraction!
  // If the array as a whole has syntax flaws, extract each individual question object `{ "numero": ... }`
  try {
    console.warn('[JSON Repair Stage 5] Tentando recuperação cirúrgica por blocos de questões individuais...');
    const questions: any[] = [];
    
    const objectRegex = /\{\s*"numero"\s*:\s*"(?:[^"\\]|\\.)*"[\s\S]*?(?=\}\s*,\s*\{\s*"numero"|\}\s*\]|\}\s*$)/g;
    let match;
    while ((match = objectRegex.exec(cleaned)) !== null) {
      let block = match[0].trim();
      if (!block.endsWith('}')) {
        block += '}';
      }
      try {
        const item = JSON.parse(block);
        questions.push(item);
      } catch {
        try {
          const item = JSON.parse(jsonrepair(block));
          questions.push(item);
        } catch {}
      }
    }
    
    if (questions.length > 0) {
      console.log(`[JSON Repair Stage 5] Sucesso! ${questions.length} questão(ões) recuperadas do JSON!`);
      return questions;
    }
  } catch (err5) {
    console.error('[JSON Repair Stage 5] Falha na extração por regex:', err5);
  }

  // Log snippet for diagnostics if all stages fail
  console.error('[JSON Repair Diagnostic] Início do texto bruto recebido da IA:\n', cleaned.slice(0, 500));
  throw new Error('O JSON retornado pela IA possui erros de formatação graves e não pôde ser reparado.');
}

function buildPromptForQuestions(questionsText: string): string {
  return `Extraia e classifique as questões solicitadas do documento ENEM: [${questionsText}].

DIRETRIZES DE EXTRAÇÃO:
- Localize e transcreva EXCLUSIVAMENTE as questões com os números: ${questionsText}. Ignore todo o restante do documento PDF.
- Preserve com fidelidade absoluta o enunciado original: transcreva todo o texto integralmente, sem simplificações, sem resumos, mantendo rigorosamente todos os valores numéricos, algarismos significativos (ex: mantenha "0,50 m" exatamente e NUNCA simplifique ou altere para "0,5 m"), notações científicas, fórmulas e unidades de medida exatamente como aparecem no PDF original.
- Para cada questão, extraia todas as 5 alternativas (A, B, C, D, E), preservando o texto original de cada uma delas com fidelidade total e absoluta.
- Identifique se a questão possui qualquer figura, tabela complexa (representada por imagem), gráfico, diagrama ou ilustração original associada e defina o campo "temFigura" correspondente (true ou false).

RECONHECIMENTO DE FIGURAS COM COORDENADAS (BBOX):
- Se a questão contiver qualquer figura, gráfico, ilustração, circuito ou diagrama que deva ser extraído, defina "temFigura" como true.
- Além disso, preencha o campo "figuras" identificando a localização exata da figura na página PDF em coordenadas normalizadas (de 0.0 a 1.0) em relação à largura e altura da página.
- No campo "figuras", defina uma lista contendo objetos com:
  - "tipo": (ex: "grafico", "ilustracao", "circuito", "diagrama")
  - "pagina": o índice numérico da página (começando em 0) no PDF recebido onde essa figura está desenhada. Se a questão começa na página 0 e o seu gráfico está na página 1, informe "pagina": 1.
  - "bbox": o objeto contendo:
    - "x": coordenada horizontal inicial (do lado esquerdo para o direito, de 0.0 a 1.0) do canto superior esquerdo da figura.
    - "y": coordenada vertical inicial (do topo para a base, de 0.0 a 1.0) do canto superior esquerdo da figura.
    - "width": largura proporcional da figura (de 0.0 a 1.0).
    - "height": altura proporcional da figura (de 0.0 a 1.0).
- REQUISITO DE PRECISÃO ABSOLUTA: Seja extremamente rigoroso, milimétrico e cirúrgico ao calcular a bbox. O retângulo deve englobar estritamente a ilustração física e suas legendas imediatas. NÃO inclua textos de enunciado, tabelas de dados ou partes de questões adjacentes (acima ou abaixo). Se o retângulo ficar muito grande ou deslocado, o corte incluirá textos indesejados. Ajuste a coordenada "y" e a "height" para ficarem coladas nas bordas da ilustração.

REPRODUÇÃO DE TABELAS, LISTAS E FÓRMULAS (ESSENCIAL):
- Se a questão contiver tabelas (dados em linhas e colunas), você DEVE transcrevê-las obrigatoriamente usando o ambiente LaTeX "tabular" (ex: \\begin{tabular}{|c|c|} \\hline Cabeçalho 1 & Cabeçalho 2 \\\\ \\hline Dado 1 & Dado 2 \\\\ \\hline \\end{tabular}) diretamente embutido no texto do campo "enunciado", garantindo que ela compile perfeitamente e fique legível.
- Se a questão contiver listas de itens, tópicos ou enumerações no corpo do enunciado, você DEVE formatá-las obrigatoriamente usando os ambientes LaTeX nativos "itemize" ou "enumerate" (ex: \\begin{itemize} \\item Item 1 \\item Item 2 \\end{itemize}).
- Escreva todas as fórmulas físicas, variables ou números com expoentes usando a notação matemática nativa do LaTeX (ex: $E = m \\cdot c^2$, $2 \\cdot 10^3\\text{ J}$, $5\\text{ m/s}$) para que a renderização no arquivo .tex compilado seja profissional e legível.

DIRETRIZES DE CLASSIFICAÇÃO:
- Classifique cada questão individualmente em uma das 6 temáticas oficiais do ENEM: Mecânica, Eletricidade e Magnetismo, Termologia, Óptica, Ondulatória, Física Moderna. Caso a questão não pertença a nenhuma destas áreas ou não seja identificável, defina o campo "tema" como null.
- Defina o subtema específico correspondente (ex: Cinemática, Dinâmica, Eletrostática, Calorimetria, etc.).
- Não extraia gabaritos nem escreva resoluções pedagógicas para economizar tokens e agilizar o retorno.

Sua resposta deve ser estritamente um array JSON estruturado conforme o seguinte formato:
[
  {
    "numero": "Questão XX (ENEM YYYY)",
    "enunciado": "Enunciado original transcrito da questão...",
    "tema": "Mecânica",
    "subtema": "Cinemática",
    "alternativas": [
      { "letra": "A", "texto": "Texto original transcrito da alternativa..." }
    ],
    "temFigura": true,
    "figuras": [
      {
        "tipo": "grafico",
        "pagina": 0,
        "bbox": {
          "x": 0.18,
          "y": 0.42,
          "width": 0.64,
          "height": 0.25
        }
      }
    ]
  }
]

DIRETRIZES CRÍTICAS DE FORMATAÇÃO DO JSON:
- No JSON, barras invertidas do LaTeX em enunciados ou fórmulas DEVEM ser duplicadas (ex: \\\\begin{tabular}, \\\\frac{a}{b}, \\\\alpha, \\\\times, \\\\hline).
- NUNCA utilize aspas duplas desprotegidas no meio de um texto ou enunciado. Se o enunciado citar palavras ou expressões entre aspas no original (ex: o termo "força"), converta-as para aspas simples (o termo 'força') ou escape com \\\\".
- Retorne estritamente o array JSON sem delimitadores markdown extras fora do formato.`;
}

function getPagesForQuestions(numbers: number[], orderedPages: string[]): number[] {
  const pageIndexesToExtract = new Set<number>();
  for (const reqNum of numbers) {
    const regexQuestao = new RegExp(`(?:QUESTÃO|Questão|Questao)[\\s\\S]{0,15}\\b${reqNum}\\b`, 'i');
    const regexStartLine = new RegExp(`(?:^|\\n|\\r)[ \t]*\\b${reqNum}\\b\\s*[\\.\\-–—\\)]`, 'i');
    const regexStandalone = new RegExp(`(?<!\\d)${reqNum}(?!\\d)`, 'g');

    let bestPageIdx = -1;
    let maxScore = -1;

    for (let i = 0; i < orderedPages.length; i++) {
      const pageText = orderedPages[i] || '';
      let score = 0;
      if (regexQuestao.test(pageText)) score += 100;
      if (regexStartLine.test(pageText)) score += 50;
      const matches = pageText.match(regexStandalone);
      if (matches && matches.length > 0) score += Math.min(matches.length * 3, 15);

      if (score > maxScore) {
        maxScore = score;
        bestPageIdx = i;
      }
    }

    if (bestPageIdx !== -1 && maxScore >= 12) {
      pageIndexesToExtract.add(bestPageIdx);
      if (bestPageIdx + 1 < orderedPages.length) {
        pageIndexesToExtract.add(bestPageIdx + 1);
      }
    }
  }

  return Array.from(pageIndexesToExtract).sort((a, b) => a - b);
}

async function extractSingleChunk({
  chunkNumbers,
  fullPdfBuffer,
  orderedPages,
  provider,
  ai
}: {
  chunkNumbers: number[];
  fullPdfBuffer: Buffer;
  orderedPages: string[];
  provider: string;
  ai: any;
}): Promise<{ questions: any[]; usedProvider: string }> {
  const chunkText = chunkNumbers.join(', ');
  const chunkIndexesArray = getPagesForQuestions(chunkNumbers, orderedPages);
  
  let finalPdfPath: string | null = null;
  let splitTempFilePath: string | null = null;
  let isSplitUsed = false;

  if (chunkIndexesArray.length > 0) {
    console.log(`[Batch Engine] Chunk [${chunkText}] localizado nas páginas: ${chunkIndexesArray.map(p => p + 1).join(', ')}`);
    const splitPdfBuffer = await extractSpecificPages(fullPdfBuffer, chunkIndexesArray);
    splitTempFilePath = path.join('/tmp', `chunk_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    await fs.promises.writeFile(splitTempFilePath, splitPdfBuffer);
    finalPdfPath = splitTempFilePath;
    isSplitUsed = true;
  } else {
    // If specific pages not found via text, write full buffer to temp
    splitTempFilePath = path.join('/tmp', `full_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    await fs.promises.writeFile(splitTempFilePath, fullPdfBuffer);
    finalPdfPath = splitTempFilePath;
  }

  const finalPrompt = buildPromptForQuestions(chunkText);
  const textContext = chunkIndexesArray.length > 0 
    ? chunkIndexesArray.map(idx => `--- PÁGINA ${idx + 1} ---\n${orderedPages[idx] || ''}`).join('\n\n')
    : orderedPages.map((page, idx) => `--- PÁGINA ${idx + 1} ---\n${page}`).join('\n\n');

  const textPromptForFallback = `Abaixo estão os textos das páginas relevantes extraídos do PDF da prova do ENEM.
Por favor, processe esses textos, extraia as questões especificadas (${chunkText}) e classifique-as.

REQUISITO EXTREMAMENTE IMPORTANTE:
- Retorne obrigatoriamente e estritamente apenas um array JSON válido. Sem explicações ou introduções fora do formato.
- IDENTIFICAÇÃO DE IMAGENS/FIGURAS: Se o enunciado ou texto da questão fizer referência a qualquer imagem, figura, gráfico, tirinha, charge, tabela ou esquema (ex: "conforme a figura", "no gráfico", "na tirinha", "esquema abaixo", "a imagem ilustra"), você DEVE marcar "temFigura": true e preencher o array "figuras" com [{"tipo": "imagem", "pagina": 0}]. Se não houver figura, marque "temFigura": false e "figuras": [].
- O formato do JSON deve ser exatamente:
[
  {
    "numero": "Questão XX (ENEM YYYY)",
    "enunciado": "Enunciado transcrito da questão em LaTeX...",
    "tema": "Mecânica",
    "subtema": "Cinemática",
    "alternativas": [
      { "letra": "A", "texto": "Texto original..." }
    ],
    "temFigura": true,
    "figuras": [
      { "tipo": "imagem", "pagina": 0 }
    ]
  }
]

TEXTO DO PDF:
${textContext}

INSTRUÇÕES ORIGINAIS DE EXTRAÇÃO:
${finalPrompt}`;

  let rawText = '';
  let usedProvider = provider === 'groq' ? 'Groq' : provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
  let uploadedRemoteFile: any = null;

  try {
    if (provider === 'groq') {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) throw new Error('GROQ_API_KEY não configurada.');
      rawText = await callGroqWithRetry(groqKey, textPromptForFallback);
    } else if (provider === 'openrouter') {
      const openRouterKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterKey) throw new Error('OPENROUTER_API_KEY não configurada.');
      rawText = await callOpenRouter(openRouterKey, textPromptForFallback);
    } else {
      // Gemini / Auto
      const contents: any[] = [];
      let useFilesApi = false;
      try {
        uploadedRemoteFile = await uploadFileWithRetry(ai, finalPdfPath);
        if (uploadedRemoteFile && uploadedRemoteFile.uri) {
          useFilesApi = true;
          contents.push({
            fileData: {
              fileUri: uploadedRemoteFile.uri,
              mimeType: uploadedRemoteFile.mimeType || "application/pdf"
            }
          });
        }
      } catch (uploadErr) {
        console.warn('[Gemini Files API] Fallback inlineData para o chunk...', uploadErr);
      }

      if (!useFilesApi) {
        const fileBuffer = await fs.promises.readFile(finalPdfPath);
        contents.push({
          inlineData: {
            mimeType: "application/pdf",
            data: fileBuffer.toString('base64')
          }
        });
      }

      contents.push({ text: finalPrompt });

      try {
        const response: any = await generateContentWithRetry(ai, {
          contents: contents,
          config: {
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  numero: { type: Type.STRING },
                  enunciado: { type: Type.STRING },
                  tema: { type: Type.STRING },
                  subtema: { type: Type.STRING },
                  alternativas: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        letra: { type: Type.STRING },
                        texto: { type: Type.STRING }
                      },
                      required: ["letra", "texto"]
                    }
                  },
                  temFigura: { type: Type.BOOLEAN },
                  figuras: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        tipo: { type: Type.STRING },
                        pagina: { type: Type.INTEGER },
                        bbox: {
                          type: Type.OBJECT,
                          properties: {
                            x: { type: Type.NUMBER },
                            y: { type: Type.NUMBER },
                            width: { type: Type.NUMBER },
                            height: { type: Type.NUMBER }
                          },
                          required: ["x", "y", "width", "height"]
                        }
                      },
                      required: ["tipo", "pagina", "bbox"]
                    }
                  }
                },
                required: ["numero", "enunciado", "subtema", "alternativas", "temFigura"]
              }
            }
          }
        });
        rawText = response.text || response.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
        if (!rawText || rawText.trim() === '' || rawText.trim() === '[]') {
          throw new Error('Gemini retornou resposta vazia.');
        }
      } catch (geminiErr) {
        console.warn('[Fallback System] Fallback no chunk para Groq / OpenRouter...', geminiErr);
        const groqKey = process.env.GROQ_API_KEY;
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        if (groqKey) {
          rawText = await callGroqWithRetry(groqKey, textPromptForFallback);
          usedProvider = 'Groq';
        } else if (openRouterKey) {
          rawText = await callOpenRouter(openRouterKey, textPromptForFallback);
          usedProvider = 'OpenRouter';
        } else {
          throw geminiErr;
        }
      }
    }
  } finally {
    if (splitTempFilePath) {
      try { await fs.promises.unlink(splitTempFilePath); } catch {}
    }
    if (uploadedRemoteFile && uploadedRemoteFile.name) {
      try { await ai.files.delete({ name: uploadedRemoteFile.name }); } catch {}
    }
  }

  const parsed = parseAndRepairJson(rawText);

  // Map relative figure page index back to original PDF page index
  for (const q of parsed) {
    if (q.figuras && Array.isArray(q.figuras)) {
      for (const fig of q.figuras) {
        if (typeof fig.pagina === 'number' && chunkIndexesArray.length > 0 && fig.pagina < chunkIndexesArray.length) {
          fig._originalPageIdx = chunkIndexesArray[fig.pagina];
        }
      }
    }
  }

  return { questions: parsed, usedProvider };
}

// Classify endpoint
app.post('/api/classify', upload.single('pdfFile'), async (req, res) => {
  const { examText, provider = 'auto' } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo PDF da prova do ENEM foi fornecido para análise.' });
  }
  if (!examText || examText.trim() === '') {
    try {
      await fs.promises.unlink(file.path);
    } catch {}
    return res.status(400).json({ error: 'Por favor, informe ao menos uma questão a ser extraída (ex: 95, 112).' });
  }

  let orderedPages: string[] = [];
  const startTotal = Date.now();

  try {
    const fullPdfBuffer = await fs.promises.readFile(file.path);
    const pdfHash = calculateBufferHash(fullPdfBuffer);

    // Get and cache ordered page texts
    if (pdfPageTextCache.has(pdfHash)) {
      orderedPages = pdfPageTextCache.get(pdfHash)!;
    } else {
      orderedPages = await getPdfPagesText(fullPdfBuffer);
      pdfPageTextCache.set(pdfHash, orderedPages);
      if (pdfPageTextCache.size > 50) {
        const firstKey = pdfPageTextCache.keys().next().value;
        if (firstKey) pdfPageTextCache.delete(firstKey);
      }
    }

    // Cleanly parse all requested numbers (e.g. "91, 92, 93 ...")
    const requestedNumbers = examText
      .split(',')
      .map((s: string) => parseInt(s.trim(), 10))
      .filter((n: number) => !isNaN(n));

    if (requestedNumbers.length === 0) {
      return res.status(400).json({ error: 'Nenhum número válido de questão foi informado.' });
    }

    // High-performance batching: Divide requested questions into small chunks of 3 questions each
    const CHUNK_SIZE = 3;
    const chunks: number[][] = [];
    for (let i = 0; i < requestedNumbers.length; i += CHUNK_SIZE) {
      chunks.push(requestedNumbers.slice(i, i + CHUNK_SIZE));
    }

    console.log(`[Batch Engine] Processando ${requestedNumbers.length} questões divididas em ${chunks.length} bloco(s) de até ${CHUNK_SIZE} questões.`);

    const allQuestions: any[] = [];
    let detectedProvider = 'Gemini';

    // Process chunks concurrently in pairs of 2 to optimize throughput without exceeding rate limits
    for (let i = 0; i < chunks.length; i += 2) {
      const currentBatch = chunks.slice(i, i + 2);
      const results = await Promise.all(
        currentBatch.map(chunk =>
          extractSingleChunk({
            chunkNumbers: chunk,
            fullPdfBuffer,
            orderedPages,
            provider,
            ai
          })
        )
      );

      for (const r of results) {
        if (r.usedProvider) detectedProvider = r.usedProvider;
        allQuestions.push(...r.questions);
      }
    }

    // Deduplicate and sort questions numerically
    const seenNums = new Set<string>();
    const deduplicatedQuestions: any[] = [];

    for (const q of allQuestions) {
      const match = String(q.numero || '').match(/\d+/);
      const numKey = match ? match[0] : (q.numero || Math.random().toString());
      if (!seenNums.has(numKey)) {
        seenNums.add(numKey);
        deduplicatedQuestions.push(q);
      }
    }

    deduplicatedQuestions.sort((a, b) => {
      const numA = parseInt(String(a.numero || '').match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(String(b.numero || '').match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });

    let parsedJson = deduplicatedQuestions;

    // Load source PDF document once for figure cropping
    let sourcePdfDoc: PDFDocument | null = null;
    try {
      sourcePdfDoc = await PDFDocument.load(fullPdfBuffer);
    } catch (loadErr) {
      console.error('[Figure Cropper] Falha ao carregar o PDF de origem:', loadErr);
    }

    if (sourcePdfDoc) {
      for (const q of parsedJson) {
        const textHasFigureCue = /(?:figura|gr[aá]fico|tabela|esquema|tirinha|charge|imagem|ilustra[çc][aã]o|ilustrad[ao]|veja o desenho)/i.test(q.enunciado || '');
        if (textHasFigureCue && (!q.temFigura || !Array.isArray(q.figuras) || q.figuras.length === 0)) {
          q.temFigura = true;
          q.figuras = [{ tipo: 'imagem', pagina: 0, bbox: { x: 0.05, y: 0.05, width: 0.9, height: 0.85 } }];
        }

        if (q.temFigura && Array.isArray(q.figuras) && q.figuras.length > 0) {
          try {
            const matchNum = String(q.numero || '').match(/\d+/);
            const reqNum = matchNum ? parseInt(matchNum[0], 10) : null;

            if (reqNum) {
              const regex1 = new RegExp(`(?:QUESTÃO|Questão|Questao)\\s*(?:de\\s+)?(?:n[º°o]\\s*)?\\s*[:-–—]?\\s*${reqNum}\\b`, 'i');
              const regex2 = new RegExp(`(?:^|\\n|\\r)\\s*${reqNum}\\s*[\\.\\-–—]\\s*`, 'i');
              let foundPageIdx = -1;
              for (let i = 0; i < orderedPages.length; i++) {
                const pageText = orderedPages[i] || '';
                if (regex1.test(pageText) || regex2.test(pageText)) {
                  foundPageIdx = i;
                  break;
                }
              }

              if (foundPageIdx !== -1) {
                q.figurasBase64 = [];
                for (let figIdx = 0; figIdx < q.figuras.length; figIdx++) {
                  const fig = q.figuras[figIdx];
                  const bbox = fig?.bbox || { x: 0.05, y: 0.05, width: 0.9, height: 0.85 };
                  if (bbox) {
                    let normX = bbox.x;
                    let normY = bbox.y;
                    let normW = bbox.width;
                    let normH = bbox.height;

                    if (normX > 1.0 || normY > 1.0 || normW > 1.0 || normH > 1.0) {
                      normX = normX / 1000.0;
                      normY = normY / 1000.0;
                      normW = normW / 1000.0;
                      normH = normH / 1000.0;
                    }

                    let originalPageIdx = (typeof fig?._originalPageIdx === 'number') ? fig._originalPageIdx : foundPageIdx;
                    if (originalPageIdx < 0 || originalPageIdx >= sourcePdfDoc.getPageCount()) {
                      originalPageIdx = foundPageIdx;
                    }

                    const croppedDoc = await PDFDocument.create();
                    const [copiedPage] = await croppedDoc.copyPages(sourcePdfDoc, [originalPageIdx]);
                    croppedDoc.addPage(copiedPage);

                    const mediaBox = copiedPage.getMediaBox();
                    const cropBox = copiedPage.getCropBox() || mediaBox;
                    const viewBox = cropBox;

                    const rawCropX = viewBox.x + (normX * viewBox.width);
                    const rawCropY = viewBox.y + viewBox.height - (normY * viewBox.height) - (normH * viewBox.height);
                    const rawCropWidth = normW * viewBox.width;
                    const rawCropHeight = normH * viewBox.height;

                    const margin = 28.35; // 1cm margin
                    const cropX = Math.max(viewBox.x, rawCropX - margin);
                    const cropY = Math.max(viewBox.y, rawCropY - margin);

                    let cropWidth = rawCropWidth + (rawCropX - cropX) + margin;
                    if (cropX + cropWidth > viewBox.x + viewBox.width) {
                      cropWidth = viewBox.x + viewBox.width - cropX;
                    }

                    let cropHeight = rawCropHeight + (rawCropY - cropY) + margin;
                    if (cropY + cropHeight > viewBox.y + viewBox.height) {
                      cropHeight = viewBox.y + viewBox.height - cropY;
                    }

                    copiedPage.setMediaBox(cropX, cropY, cropWidth, cropHeight);
                    copiedPage.setCropBox(cropX, cropY, cropWidth, cropHeight);

                    const croppedPdfBytes = await croppedDoc.save();
                    const figBase64 = Buffer.from(croppedPdfBytes).toString('base64');
                    q.figurasBase64.push(figBase64);

                    if (figIdx === 0) {
                      q.figuraBase64 = figBase64;
                    }
                  }
                }
              }
            }
          } catch (cropErr) {
            console.error('[Figure Cropper] Falha ao cortar a figura:', cropErr);
          }
        }
      }
    }

    const totalTime = (Date.now() - startTotal) / 1000;
    console.log(`[Batch Engine] Concluído com sucesso! ${parsedJson.length} questões extraídas em ${totalTime.toFixed(2)}s.`);

    res.setHeader('Content-Type', 'application/json');
    res.json({
      questions: parsedJson,
      performance: {
        total: totalTime
      }
    });

  } catch (error: any) {
    console.error('Error classifying exam with Gemini:', error);
    res.setHeader('Content-Type', 'application/json');
    const errStr = String(error?.message || error || '');
    if (errStr.includes('429') || errStr.includes('Quota exceeded') || errStr.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({
        error: 'O limite de cota da API do Gemini foi temporariamente atingido. Por favor, aguarde alguns instantes e tente novamente!'
      });
    }
    if (errStr.includes('503') || errStr.includes('high demand') || errStr.includes('UNAVAILABLE')) {
      return res.status(500).json({ 
        error: 'O serviço do Gemini está temporariamente sobrecarregado ou indisponível. O sistema tentou novamente de forma automática com múltiplos modelos e backoff, mas não conseguiu concluir a solicitação no momento. Por favor, tente novamente em alguns instantes!' 
      });
    }
    if (errStr.includes('fetch failed') || errStr.includes('ECONNRESET') || errStr.includes('ETIMEDOUT')) {
      return res.status(500).json({
        error: 'A conexão com a API do Gemini sofreu uma oscilação na rede ao transferir o arquivo PDF. Por favor, clique novamente em Extrair Questões.'
      });
    }
    res.status(500).json({ error: error?.message || 'Erro ao classificar a prova com o Gemini.' });
  } finally {
    // Clean up local original temp file
    if (file && file.path) {
      fs.promises.unlink(file.path).catch(() => {});
    }
  }
});

// Serve static frontend assets in production
if (process.env.NODE_ENV === 'production' || process.env.VITE_PROD === 'true') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  // In development, mount Vite's middlewares dynamically
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { 
      middlewareMode: true,
      hmr: false, // matches vite.config
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

// Global fallback error handler for API requests to avoid returning default HTML error pages
app.use((err: any, req: any, res: any, next: any) => {
  console.error('[Global Error Handler]:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || err.statusCode || 500).json({ 
    error: err.message || 'Ocorreu um erro interno no servidor.' 
  });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
server.setTimeout(300000); // 5 minutes
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
