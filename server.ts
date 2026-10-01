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
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';

import crypto from 'crypto';

dotenv.config();

// In-memory cache for extracted PDF page texts
// Key: SHA-256 fingerprint of the PDF file buffer
// Value: string[] of page text contents
const pdfPageTextCache = new Map<string, string[]>();

function calculateBufferHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Helper to extract text from a PDF page-by-page safely using the modern PDFParse class API
async function getPdfPagesText(fileBuffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const result = await parser.getText();
    // Sort pages by page number (1-based index) ascending
    const sortedPages = [...result.pages].sort((a, b) => a.num - b.num);
    const orderedPages: string[] = sortedPages.map(p => p.text);
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
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash'
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
  let splitTempFilePath: string | null = null;
  let orderedPages: string[] = [];

  const startTotal = Date.now();
  let startUploadGemini = 0;
  let endUploadGemini = 0;
  let startGenerateContent = 0;
  let endGenerateContent = 0;
  let startParse = 0;
  let endParse = 0;

  try {
    const finalPrompt = `Extraia e classifique as questões solicitadas do documento ENEM: [${examText}].

DIRETRIZES DE EXTRAÇÃO:
- Localize e transcreva EXCLUSIVAMENTE as questões com os números: ${examText}. Ignore todo o restante do documento PDF.
- Preserve com fidelidade absoluta o enunciado original: transcreva todo o texto integralmente, sem simplificações, sem resumos, mantendo rigorosamente todos os valores numéricos, algarismos significativos (ex: mantenha "0,50 m" exatamente e NUNCA simplifique ou altere para "0,5 m"), notações científicas, fórmulas e unidades de medida exatamente como aparecem no PDF original.
- Para cada questão, extraia todas as 5 alternativas (A, B, C, D, E), preservando o texto original de cada uma delas com fidelidade total e absoluta.
- Identifique se a questão possui qualquer figura, tabela complexa (representada por imagem), gráfico, diagrama ou ilustração original associada e defina o campo "temFigura" correspondente (true ou false).

RECONHECIMENTO DE FIGURAS COM COORDENADAS (BBOX):
- Se a questão contiver qualquer figura, gráfico, ilustração, circuito ou diagrama que deva ser extraído, defina "temFigura" como true.
- Além disso, preencha o campo "figuras" identificando a localização exata da figura na página PDF em coordenadas normalizadas (de 0.0 a 1.0) em relação à largura e altura da página.
- No campo "figuras", defina uma lista contendo objetos com o "tipo" (ex: "grafico", "ilustracao", "circuito", "diagrama") e o objeto "bbox" contendo:
  - "x": coordenada horizontal inicial (do lado esquerdo para o direito, de 0.0 a 1.0) do canto superior esquerdo da figura.
  - "y": coordenada vertical inicial (do topo para a base, de 0.0 a 1.0) do canto superior esquerdo da figura.
  - "width": largura proporcional da figura (de 0.0 a 1.0).
  - "height": altura proporcional da figura (de 0.0 a 1.0).
- Seja extremamente rigoroso e preciso nas coordenadas para garantir que o corte contenha toda a figura e suas legendas perfeitamente.

REPRODUÇÃO DE TABELAS, LISTAS E FÓRMULAS (ESSENCIAL):
- Se a questão contiver tabelas (dados em linhas e colunas), você DEVE transcrevê-las obrigatoriamente usando o ambiente LaTeX "tabular" (ex: \begin{tabular}{|c|c|} \hline Cabeçalho 1 & Cabeçalho 2 \\ \hline Dado 1 & Dado 2 \\ \hline \end{tabular}) diretamente embutido no texto do campo "enunciado", garantindo que ela compile perfeitamente e fique legível.
- Se a questão contiver listas de itens, tópicos ou enumerações no corpo do enunciado, você DEVE formatá-las obrigatoriamente usando os ambientes LaTeX nativos "itemize" ou "enumerate" (ex: \begin{itemize} \item Item 1 \item Item 2 \end{itemize}).
- Escreva todas as fórmulas físicas, variáveis ou números com expoentes usando a notação matemática nativa do LaTeX (ex: $E = m \cdot c^2$, $2 \cdot 10^3\text{ J}$, $5\text{ m/s}$) para que a renderização no arquivo .tex compilado seja profissional e legível.

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
        "bbox": {
          "x": 0.18,
          "y": 0.42,
          "width": 0.64,
          "height": 0.25
        }
      }
    ]
  }
]`;

    // Read full PDF buffer
    const fullPdfBuffer = await fs.promises.readFile(file.path);
    const pdfHash = calculateBufferHash(fullPdfBuffer);

    // Local Search & Precise Page Selection Optimization
    const requestedNumbers = examText.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
    let finalPdfPath = file.path;
    let isSplitUsed = false;

    if (requestedNumbers.length > 0) {
      try {
        orderedPages = [];
        if (pdfPageTextCache.has(pdfHash)) {
          console.log(`[Cache Hit] Utilizando textos das páginas indexados do cache local (Hash: ${pdfHash}).`);
          orderedPages = pdfPageTextCache.get(pdfHash)!;
        } else {
          console.log(`[Cache Miss] Analisando texto das páginas do PDF localmente (Hash: ${pdfHash})...`);
          orderedPages = await getPdfPagesText(fullPdfBuffer);
          pdfPageTextCache.set(pdfHash, orderedPages);
          console.log(`[Cache Map] Textos salvos no cache local para reuso em futuras requisições.`);
          
          // Keep cache size under control (e.g., max 50 PDFs cached in memory)
          if (pdfPageTextCache.size > 50) {
            const firstKey = pdfPageTextCache.keys().next().value;
            if (firstKey) pdfPageTextCache.delete(firstKey);
          }
        }

        const pageIndexesToExtract = new Set<number>();

        for (const reqNum of requestedNumbers) {
          const regex = new RegExp(`QUESTÃO\\s+${reqNum}\\b|Questão\\s+${reqNum}\\b`, 'i');
          for (let i = 0; i < orderedPages.length; i++) {
            if (regex.test(orderedPages[i])) {
              pageIndexesToExtract.add(i);
              // Include the next page as well, in case the question flows to the next page!
              if (i + 1 < orderedPages.length) {
                pageIndexesToExtract.add(i + 1);
              }
            }
          }
        }

        if (pageIndexesToExtract.size > 0) {
          const indexesArray = Array.from(pageIndexesToExtract);
          console.log(`[Local Optimization] Questões localizadas nas páginas (1-indexed): ${indexesArray.map(p => p + 1).join(', ')}. Extraindo apenas estas páginas...`);
          const splitPdfBuffer = await extractSpecificPages(fullPdfBuffer, indexesArray);
          
          splitTempFilePath = path.join('/tmp', `split_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
          await fs.promises.writeFile(splitTempFilePath, splitPdfBuffer);
          finalPdfPath = splitTempFilePath;
          isSplitUsed = true;
        } else {
          console.log('[Local Optimization] Nenhuma página correspondente foi localizada pelo texto. Utilizando o PDF completo como fallback seguro.');
        }
      } catch (splitErr) {
        console.warn('[Local Optimization] Falha ao tentar dividir o PDF localmente, utilizando o PDF completo como fallback seguro:', splitErr);
      }
    }

    startUploadGemini = Date.now();
    const contents: any[] = [];
    
    // Use Gemini Files API for reliable upload of dense PDF documents.
    // This prevents ECONNRESET and fetch failed caused by massive inline base64 payloads in JSON bodies.
    let useFilesApi = false;
    try {
      uploadedRemoteFile = await ai.files.upload({
        file: finalPdfPath,
        config: {
          mimeType: "application/pdf"
        }
      });

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
      console.warn('[Files API Fallback] Falha no upload via ai.files, utilizando inlineData:', uploadErr);
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
    endUploadGemini = Date.now();
    
    contents.push({ text: finalPrompt });

    startGenerateContent = Date.now();
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
              temFigura: { type: Type.BOOLEAN },
              figuras: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tipo: { type: Type.STRING },
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
                  required: ["tipo", "bbox"]
                }
              }
            },
            required: ["numero", "enunciado", "subtema", "alternativas", "temFigura"]
          }
        }
      }
    });
    endGenerateContent = Date.now();

    startParse = Date.now();
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
        console.warn('[Gemini Output] Falha no parse inicial do JSON. Tentando reparação com jsonrepair...');
        const repaired = jsonrepair(rawText);
        parsedJson = JSON.parse(repaired);
      } catch (repairErr) {
        console.error('[Gemini Output] Falha crítica de sintaxe no JSON retornado:', repairErr);
        throw new Error('O JSON retornado pela IA possui erros de sintaxe graves e não pôde ser reparado.');
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
    // Process each question to crop figures using pdf-lib if figures and bbox are provided
    for (const q of parsedJson) {
      if (q.temFigura && Array.isArray(q.figuras) && q.figuras.length > 0) {
        try {
          const matchNum = String(q.numero || '').match(/\d+/);
          const reqNum = matchNum ? parseInt(matchNum[0], 10) : null;
          
          if (reqNum) {
            // Find which page index this question is on (0-indexed)
            const regex = new RegExp(`QUESTÃO\\s+${reqNum}\\b|Questão\\s+${reqNum}\\b`, 'i');
            let foundPageIdx = -1;
            for (let i = 0; i < orderedPages.length; i++) {
              if (regex.test(orderedPages[i])) {
                foundPageIdx = i;
                break;
              }
            }

            if (foundPageIdx !== -1) {
              const fig = q.figuras[0];
              if (fig && fig.bbox) {
                const bbox = fig.bbox;
                const pdfDoc = await PDFDocument.load(fullPdfBuffer);
                const page = pdfDoc.getPage(foundPageIdx);
                const { width: pageW, height: pageH } = page.getSize();

                const cropX = bbox.x * pageW;
                // Since Gemini's Y coordinate starts from the top, and PDF starts from bottom
                const cropY = pageH - (bbox.y * pageH) - (bbox.height * pageH);
                const cropWidth = bbox.width * pageW;
                const cropHeight = bbox.height * pageH;

                // Set bounding box bounds securely
                page.setMediaBox(cropX, cropY, cropWidth, cropHeight);
                page.setCropBox(cropX, cropY, cropWidth, cropHeight);

                const croppedDoc = await PDFDocument.create();
                const [copiedPage] = await croppedDoc.copyPages(pdfDoc, [foundPageIdx]);
                croppedDoc.addPage(copiedPage);

                const croppedPdfBytes = await croppedDoc.save();
                q.figuraBase64 = Buffer.from(croppedPdfBytes).toString('base64');
                console.log(`[Figure Cropper] Sucesso ao cortar figura vetorizada para Questão ${reqNum} na página ${foundPageIdx + 1}`);
              }
            }
          }
        } catch (cropErr) {
          console.error('[Figure Cropper] Falha ao cortar a figura da questão:', cropErr);
        }
      }
    }

    endParse = Date.now();

    res.setHeader('Content-Type', 'application/json');

    const totalTime = (Date.now() - startTotal) / 1000;
    const recebimentoTime = (startUploadGemini - startTotal) / 1000;
    const uploadGeminiTime = (endUploadGemini - startUploadGemini) / 1000;
    const generateContentTime = (endGenerateContent - startGenerateContent) / 1000;
    const parseTime = (endParse - startParse) / 1000;

    console.log(`
[PERFORMANCE]
recebimento: ${recebimentoTime.toFixed(2)} seg
upload Gemini: ${uploadGeminiTime.toFixed(2)} seg
generateContent: ${generateContentTime.toFixed(2)} seg
parse: ${parseTime.toFixed(2)} seg
total: ${totalTime.toFixed(2)} seg
`);

    res.json({
      questions: parsedJson,
      performance: {
        recebimento: recebimentoTime,
        uploadGemini: uploadGeminiTime,
        generateContent: generateContentTime,
        parse: parseTime,
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
    // Clean up local original temp file
    if (file && file.path) {
      fs.promises.unlink(file.path).catch(() => {});
    }
    // Clean up local split temp file
    if (splitTempFilePath) {
      fs.promises.unlink(splitTempFilePath).catch(() => {});
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
