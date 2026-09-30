/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { jsonrepair } from 'jsonrepair';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
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
  'gemini-3-flash-preview',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash'
];

/// Helper to execute Gemini calls with automatic exponential backoff for transient 503/high-demand errors,
/// network drops (fetch failed, ECONNRESET, ETIMEDOUT), and dynamic model fallbacks on 429 quota exhaustion.
async function generateContentWithRetry(aiClient: any, params: any, maxRetriesPerModel = 2) {
  let lastError: any = new Error('Falha ao obter resposta do Gemini após várias tentativas e modelos de fallback.');

  // Try each candidate model in order of reliability and availability
  for (const model of CANDIDATE_MODELS) {
    for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
      try {
        console.log(`[Gemini API] Executando chamada com o modelo '${model}' (tentativa ${attempt}/${maxRetriesPerModel})...`);
        const mergedParams = { ...params, model };
        return await aiClient.models.generateContent(mergedParams);
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

        console.warn(`[Gemini API] Falha no modelo '${model}' (tentativa ${attempt}): ${errorMsg || errorStr}`);

        // If high demand (503), quota exhausted (429), or connection dropped, immediately switch to next model
        if (is503 || is429 || isNetworkOrReset) {
          console.warn(`[Gemini API] Modelo '${model}' instável ou sob alta demanda. Alternando para o próximo modelo candidato...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          break; // break inner loop to try next model in CANDIDATE_MODELS
        }

        // For other recoverable errors, backoff and retry
        if (attempt < maxRetriesPerModel) {
          await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        } else {
          break;
        }
      }
    }
  }

  throw lastError;
}

// Classify endpoint
app.post('/api/classify', upload.single('pdfFile'), async (req, res) => {
  const { examText } = req.body;
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

  let uploadedRemoteFile: any = null;

  try {
    const finalPrompt = `Você é um professor de física experiente, especializado no ENEM. 
Sua tarefa é analisar o documento fornecido e extrair EXCLUSIVAMENTE as questões solicitadas pelo usuário: [${examText}].

Instruções críticas para otimização de processamento:
1. Ignore completamente todo o restante do PDF. Concentre seu processamento APENAS em localizar as questões numéricas correspondentes aos números: ${examText}.
2. Para cada uma dessas questões listadas, extraia o enunciado completo, as alternativas (A a E) e identifique se ela possui qualquer tipo de figura, tabela de dados ou gráfico original associado (definindo "temFigura" como true ou false). IMPORTANTE: Preserve com fidelidade absoluta o enunciado original, todos os valores numéricos, algarismos significativos (ex: mantenha "0,50 m" exatamente e NUNCA simplifique ou altere para "0,5 m"), notações científicas, unidades de medida e os textos originais das alternativas exatamente como aparecem na prova.
3. Classifique-as individualmente em uma das 6 temáticas oficiais (Mecânica, Eletricidade e Magnetismo, Termologia, Óptica, Ondulatória, Física Moderna) e defina o subtema correspondente.
4. Não extraia gabaritos nem escreva resoluções didáticas para economizar tokens, reduzir o uso de IA e acelerar a resposta.

Você deve retornar estritamente um array JSON contendo objetos com a seguinte estrutura de tipos:
[
  {
    "numero": "Questão XX (ENEM YYYY)",
    "enunciado": "O enunciado limpo da questão...",
    "tema": "Mecânica",
    "subtema": "Cinemática",
    "alternativas": [
      { "letra": "A", "texto": "Texto..." },
      ...
    ],
    "temFigura": true
  }
]`;

    const contents: any[] = [];
    
    // Use Gemini Files API for reliable upload of dense PDF documents.
    // This prevents ECONNRESET and fetch failed caused by massive inline base64 payloads in JSON bodies.
    let useFilesApi = false;
    try {
      uploadedRemoteFile = await ai.files.upload({
        file: file.path,
        config: {
          mimeType: file.mimetype || "application/pdf"
        }
      });

      if (uploadedRemoteFile && uploadedRemoteFile.uri) {
        useFilesApi = true;
        contents.push({
          fileData: {
            fileUri: uploadedRemoteFile.uri,
            mimeType: uploadedRemoteFile.mimeType || file.mimetype || "application/pdf"
          }
        });
      }
    } catch (uploadErr) {
      console.warn('[Files API Fallback] Falha no upload via ai.files, utilizando inlineData:', uploadErr);
    }

    if (!useFilesApi) {
      const fileBuffer = await fs.promises.readFile(file.path);
      contents.push({
        inlineData: {
          mimeType: file.mimetype || "application/pdf",
          data: fileBuffer.toString('base64')
        }
      });
    }
    
    contents.push({ text: finalPrompt });

    const response: any = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 65536,
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
              temFigura: { type: Type.BOOLEAN }
            },
            required: ["numero", "enunciado", "tema", "subtema", "alternativas", "temFigura"]
          }
        }
      }
    });

    let rawText = response.text || '[]';
    rawText = rawText.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*/i, '');
      rawText = rawText.replace(/\s*```$/, '');
      rawText = rawText.trim();
    }

    let parsedJson: any = [];
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      try {
        const repaired = jsonrepair(rawText);
        parsedJson = JSON.parse(repaired);
      } catch (parseErr) {
        console.warn('[Gemini Output] JSON necessitando recuperação estrutural profunda...');
        const lastObjClose = rawText.lastIndexOf('},');
        if (lastObjClose !== -1) {
          const recovered = rawText.slice(0, lastObjClose + 1) + ']';
          try {
            parsedJson = JSON.parse(jsonrepair(recovered));
          } catch {
            parsedJson = JSON.parse(recovered);
          }
        } else {
          const lastBrace = rawText.lastIndexOf('}');
          if (lastBrace !== -1) {
            const recovered = rawText.slice(0, lastBrace + 1) + ']';
            try {
              parsedJson = JSON.parse(jsonrepair(recovered));
            } catch {
              parsedJson = JSON.parse(recovered);
            }
          } else {
            throw parseErr;
          }
        }
      }
    }

    // Ensure array structure
    if (!Array.isArray(parsedJson)) {
      if (parsedJson && Array.isArray((parsedJson as any).questions)) {
        parsedJson = (parsedJson as any).questions;
      } else if (parsedJson && typeof parsedJson === 'object') {
        parsedJson = [parsedJson];
      } else {
        parsedJson = [];
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.json(parsedJson);

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
        error: 'O modelo da API está sobrecarregado temporariamente por processar arquivos PDF muito extensos. Por favor, tente novamente em alguns segundos!' 
      });
    }
    if (errStr.includes('fetch failed') || errStr.includes('ECONNRESET') || errStr.includes('ETIMEDOUT')) {
      return res.status(500).json({
        error: 'A conexão com a API do Gemini sofreu uma oscilação na rede ao transferir o arquivo PDF. Por favor, clique novamente em Extrair Questões.'
      });
    }
    res.status(500).json({ error: error?.message || 'Erro ao classificar a prova com o Gemini.' });
  } finally {
    // Clean up local temp file
    if (file && file.path) {
      fs.promises.unlink(file.path).catch(() => {});
    }
    // Clean up remote Gemini Files API storage
    if (uploadedRemoteFile && uploadedRemoteFile.name) {
      ai.files.delete({ name: uploadedRemoteFile.name }).catch(() => {});
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
