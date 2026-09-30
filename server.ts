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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

// Custom body-parser error handler to prevent HTML stack traces on large payloads
app.use((err: any, req: any, res: any, next: any) => {
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
app.post('/api/classify', async (req, res) => {
  const { examText, pdfFile } = req.body;
  if (!pdfFile || !pdfFile.data) {
    return res.status(400).json({ error: 'Nenhum arquivo PDF da prova do ENEM foi fornecido para análise.' });
  }

  let tempFilePath: string | null = null;
  let uploadedRemoteFile: any = null;

  try {
    const prompt = `Você é um professor universitário e de cursinho pré-vestibular, especialista em física do ENEM (Exame Nacional do Ensino Médio).

CRÍTICO - DIRETRIZ DE NUMERAÇÃO E ESTRUTURA DO ENEM:
As questões de Ciências da Natureza do segundo dia do ENEM estão localizadas RIGOROSAMENTE e EXCLUSIVAMENTE entre as questões número 91 e 135.
- As questões de 136 a 180 pertencem à prova de Matemática e devem ser COMPLETAMENTE IGNORADAS.
- As questões de 1 a 90 pertencem ao primeiro dia de prova e também devem ser COMPLETAMENTE IGNORADAS.
- Portanto, examine detidamente APENAS o intervalo das questões 91 a 135 do documento ou texto fornecido.
- O bloco de 91 a 135 possui 45 questões no total (divididas tradicionalmente entre Física, Química e Biologia).
- Faça uma varredura sequencial EXTREMAMENTE minuciosa e exaustiva de cada uma das 45 questões, de 91 a 135, uma por uma.
- Identifique e extraia TODAS as questões que pertençam à Física ou que possuam conceitos substanciais de FÍSICA (como termodinâmica, eletricidade, óptica, mecânica, ondulatória), INCLUINDO rigorosamente as questões interdisciplinares e híbridas de FÍSICO-QUÍMICA (como eletroquímica, pilhas, reações e colisões de partículas, termoquímica, cinetismo físico) ou BIOFÍSICA (como bioeletricidade, óptica da visão, etc.).
- A prova conterá tipicamente entre 15 e 17 questões no total que envolvem conceitos de física. Se você identificar ou retornar menos de 15 questões no total, isso significa que você foi "preguiçoso" ou pulou/esqueceu de extrair alguma questão relevante! Portanto, revise mentalmente e faça uma dupla checagem exaustiva de todas as 45 questões para garantir que absolutamente nenhuma questão de física (ou físico-química) foi deixada para trás. Sua meta é extrair todas as 15 a 17 questões qualificadas!
- Descarte apenas as questões puras e exclusivas de química e biologia que não possuam nenhuma relação com fenômenos físicos ou físico-químicos.
- Certifique-se de que cada questão de física extraída preserva o seu número oficial original do ENEM (por exemplo, "Questão 95", "Questão 112", etc.).

CRÍTICO - IDENTIFICAÇÃO E EXTRAÇÃO OBRIGATÓRIA DE TABELAS E ELEMENTOS VISUAIS (GRÁFICOS, CIRCUITOS, ESQUEMAS, DIAGRAMAS):
No ENEM de Física, uma grande parte das questões depende crucialmente de TABELAS de dados ou FIGURAS visuais (como gráficos cartesianos, circuitos elétricos, diagramas ópticos de raios/lentes, esquemas de blocos/polias, ondas em cordas/tubos ou ilustrações experimentais).
Você DEVE examinar visualmente cada página do documento com extrema acuidade e identificar:

1. TABELAS ("tabela"):
Se a questão apresentar uma tabela (ex: consumo de aparelhos, materiais e calores específicos, medições experimentais, frequências):
- Preencha o objeto "tabela" com:
  - "titulo": Título ou referência da tabela (ex: "Tabela 1: Potência e tempo de uso dos aparelhos elétricos").
  - "cabecalho": Array de strings com os nomes das colunas (ex: ["Aparelho", "Potência (W)", "Tempo diário (h)"]).
  - "linhas": Matriz de linhas, onde cada linha é um array de strings com os valores de cada coluna.
  - "legenda": Nota de rodapé ou fonte da tabela, se houver.
- No "enunciado", mantenha também uma referência ou tabela em markdown limpa para que o enunciado seja autoexplicativo.

2. ELEMENTOS VISUAIS / IMAGENS / GRÁFICOS / CIRCUITOS ("figura"):
Se a questão contiver qualquer imagem, foto, gráfico (cartesiano, de setores, barras), circuito elétrico (com resistores, baterias, chaves), esquema mecânico (polias, plano inclinado, molas), diagrama óptico (lentes, espelhos, refração) ou de ondas:
- Preencha o objeto "figura" com:
  - "tipo": Um dos tipos: "Gráfico", "Circuito elétrico", "Esquema mecânico", "Diagrama óptico", "Ondas/Oscilações", "Ilustração experimental" ou "Outro".
  - "titulo": Título claro da figura (ex: "Gráfico da Força em função da Posição", "Circuito com Lâmpadas L1, L2, L3 e Chave S").
  - "descricao": Uma descrição pedagógica EXTREMAMENTE DETALHADA, rica e precisa de tudo o que a figura ilustra (os eixos cartesianos com grandezas e unidades, pontos notáveis, trajetória do corpo, conexões do circuito, sentidos de correntes ou forças). O aluno ou professor DEVE ser capaz de resolver a questão perfeitamente apenas lendo essa descrição, mesmo que a imagem física não esteja visível!
  - "dadosVisuais": Lista de strings com valores numéricos ou relações explícitas extraídas da imagem (ex: ["Eixo Y: Força F (N) variando de 0 a 50", "Eixo X: Deslocamento d (m) variando de 0 a 10", "Ponto máximo em d = 6 m com F = 50 N"]).

Para cada questão de Física detectada, estruture-a de forma impecável, corrigindo erros de digitação e formatação do ENEM clássico, e classifique-a rigorosamente em uma das 6 temáticas oficiais de física do ENEM:
1. "Mecânica"
2. "Eletricidade e Magnetismo"
3. "Termologia"
4. "Óptica"
5. "Ondulatória"
6. "Física Moderna"

Você deve retornar estritamente um array JSON contendo objetos com a seguinte estrutura de tipos:

{
  "numero": "Identificador da questão acrescido do ano do ENEM detectado no documento entre parênteses, rigorosamente no formato 'Questão XX (ENEM YYYY)'. Exemplo: 'Questão 94 (ENEM 2025)'. Identifique o ano correto da prova no documento enviado (seja no cabeçalho, rodapé ou metadados, ex: 2025, 2024, 2023, 2022). Se não houver menção explícita do ano na prova, use '2024' como padrão.",
  "enunciado": "O enunciado limpo e legível da questão em português. Substitua caracteres quebrados. Escreva equações matemáticas ou unidades de forma limpa no texto usando símbolos usuais (ex: E_c = m·v²/2, v = λ·f, 10 m/s, 2,0x10⁵ N/m²).",
  "tema": "O nome exato de uma das 6 temáticas oficiais listadas acima (Mecânica, Eletricidade e Magnetismo, Termologia, Óptica, Ondulatória, Física Moderna)",
  "subtema": "O subtema específico da física (ex: Cinemática, Dinâmica, Eletrodinâmica, Calorimetria, Óptica Geométrica, Ondas, Efeito Fotoelétrico, etc.)",
  "alternativas": [
    { "letra": "A", "texto": "Texto completo da alternativa A" },
    { "letra": "B", "texto": "Texto completo da alternativa B" },
    { "letra": "C", "texto": "Texto completo da alternativa C" },
    { "letra": "D", "texto": "Texto completo da alternativa D" },
    { "letra": "E", "texto": "Texto completo da alternativa E" }
  ],
  "gabarito": "Letra maiúscula correspondente à alternativa correta (A, B, C, D ou E)",
  "resolucao": "Uma explicação extremamente detalhada, clara, didática e pedagógica contendo a resolução analítica, as simplificações físicas e uma breve explicação de por que os distratores estão errados.",
  "formulas": [
    { "nome": "Nome da lei ou fórmula principal", "formula": "Expressão simplificada, ex: V = R · I" }
  ],
  "tabela": {
    "titulo": "Título da tabela ou null",
    "cabecalho": ["Coluna 1", "Coluna 2"],
    "linhas": [["dado1", "dado2"]],
    "legenda": "Fonte da tabela ou null"
  },
  "figura": {
    "tipo": "Gráfico",
    "titulo": "Título da imagem ou gráfico",
    "descricao": "Descrição detalhada do elemento visual",
    "dadosVisuais": ["Dado 1", "Dado 2"],
    "legenda": "Fonte ou null"
  }
}

Caso o documento fornecido não contenha nenhuma questão de física, retorne estritamente um array vazio [].
Não retorne nenhum texto explicativo fora do array JSON.`;

    const contents: any[] = [];
    if (pdfFile && pdfFile.data) {
      // Use Gemini Files API for reliable upload of dense PDF documents.
      // This prevents ECONNRESET and fetch failed caused by massive inline base64 payloads in JSON bodies.
      let useFilesApi = false;
      try {
        const tempFileName = `enem_upload_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
        tempFilePath = path.join('/tmp', tempFileName);
        const fileBuffer = Buffer.from(pdfFile.data, 'base64');
        await fs.promises.writeFile(tempFilePath, fileBuffer);

        uploadedRemoteFile = await ai.files.upload({
          file: tempFilePath,
          config: {
            mimeType: pdfFile.mimeType || "application/pdf"
          }
        });

        if (uploadedRemoteFile && uploadedRemoteFile.uri) {
          useFilesApi = true;
          contents.push({
            fileData: {
              fileUri: uploadedRemoteFile.uri,
              mimeType: uploadedRemoteFile.mimeType || pdfFile.mimeType || "application/pdf"
            }
          });
        }
      } catch (uploadErr) {
        console.warn('[Files API Fallback] Falha no upload via ai.files, utilizando inlineData:', uploadErr);
      }

      if (!useFilesApi) {
        contents.push({
          inlineData: {
            mimeType: pdfFile.mimeType || "application/pdf",
            data: pdfFile.data
          }
        });
      }
      
      let finalPrompt = prompt;
      if (examText && examText.trim() !== '') {
        finalPrompt += `\n\nATENÇÃO - INSTRUÇÕES ADICIONAIS E LISTA DE QUESTÕES DO USUÁRIO:\nO usuário forneceu as seguintes orientações e lista de questões específicas a serem extraídas. Siga-as RIGOROSAMENTE e extraia EXATAMENTE os números de questões indicados na mensagem abaixo:\n${examText}`;
      }
      contents.push({ text: finalPrompt });
    } else {
      contents.push({ text: `${prompt}\n\nTexto da Prova a analisar:\n${examText}` });
    }

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
              gabarito: { type: Type.STRING },
              resolucao: { type: Type.STRING },
              formulas: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nome: { type: Type.STRING },
                    formula: { type: Type.STRING }
                  },
                  required: ["nome", "formula"]
                }
              },
              tabela: {
                type: Type.OBJECT,
                properties: {
                  titulo: { type: Type.STRING },
                  cabecalho: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  linhas: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    }
                  },
                  legenda: { type: Type.STRING }
                }
              },
              figura: {
                type: Type.OBJECT,
                properties: {
                  tipo: {
                    type: Type.STRING,
                    description: "Tipo do elemento visual, ex: Gráfico, Circuito elétrico, Esquema mecânico, Diagrama óptico, Ondas/Oscilações, Ilustração experimental, Outro"
                  },
                  titulo: { type: Type.STRING },
                  descricao: { type: Type.STRING },
                  dadosVisuais: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  legenda: { type: Type.STRING }
                }
              }
            },
            required: ["numero", "enunciado", "tema", "subtema", "alternativas", "gabarito", "resolucao", "formulas"]
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
        // Try recovering all completed array objects
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
    if (tempFilePath) {
      fs.promises.unlink(tempFilePath).catch(() => {});
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
