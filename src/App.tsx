/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Atom, 
  Sparkles, 
  Flame, 
  Tv, 
  TrendingUp, 
  Check, 
  XCircle, 
  Upload, 
  FileText,
  Gauge,
  FileCode,
  ImageIcon,
  Trash2,
  Edit,
  Search,
  CheckSquare,
  Square,
  FolderArchive,
  SlidersHorizontal,
  Info,
  RefreshCw,
  Clock,
  Layers,
  FileDown,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { QuestaoFísica } from './types';
import { safeParseJson } from './utils/safeJson';
import { 
  generateAllThemesFiles, 
  downloadLatexFile, 
  downloadAllThemesZip, 
  generateConsolidatedLatexFile 
} from './latexExporter';

// Helper to parse and validate ENEM Physics question numbers (91 to 135)
function parseAndValidateQuestionNumbers(input: string): { valid: boolean; numbers: number[]; normalizedText: string; error?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, numbers: [], normalizedText: '', error: 'Por favor, informe ao menos um número de questão entre 91 e 135.' };
  }

  // Support range syntax like "91 a 135", "91-135", "91 até 135"
  const rangeMatch = trimmed.match(/^(\d{2,3})\s*(?:a|até|-)\s*(\d{2,3})$/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (isNaN(start) || isNaN(end) || start > end || start < 91 || end > 135) {
      return { 
        valid: false, 
        numbers: [], 
        normalizedText: '',
        error: 'O intervalo deve conter apenas valores entre 91 e 135 (ex: 91 a 135).' 
      };
    }
    const numbers: number[] = [];
    for (let i = start; i <= end; i++) numbers.push(i);
    return { valid: true, numbers, normalizedText: numbers.join(', ') };
  }

  // Split tokens by space, comma, semicolon, newline or tabs
  const rawTokens = trimmed.split(/[\s,;]+/).filter(Boolean);
  if (rawTokens.length === 0) {
    return { valid: false, numbers: [], normalizedText: '', error: 'Por favor, informe os números das questões (separados por espaço, vírgula ou ponto e vírgula).' };
  }

  const numbers: number[] = [];
  const invalidTokens: string[] = [];
  const outOfRange: number[] = [];

  for (const token of rawTokens) {
    if (/^\d{2,3}-\d{2,3}$/.test(token)) {
      const [sStr, eStr] = token.split('-');
      const s = parseInt(sStr, 10);
      const e = parseInt(eStr, 10);
      if (s < 91 || e > 135 || s > e) {
        outOfRange.push(s < 91 || s > 135 ? s : e);
      } else {
        for (let i = s; i <= e; i++) {
          if (!numbers.includes(i)) numbers.push(i);
        }
      }
      continue;
    }

    const num = parseInt(token, 10);
    if (isNaN(num) || !/^\d+$/.test(token)) {
      invalidTokens.push(token);
    } else if (num < 91 || num > 135) {
      outOfRange.push(num);
    } else {
      if (!numbers.includes(num)) {
        numbers.push(num);
      }
    }
  }

  if (invalidTokens.length > 0) {
    return {
      valid: false,
      numbers: [],
      normalizedText: '',
      error: `Formato inválido: "${invalidTokens.join(', ')}". Use apenas números separados por espaço, vírgula (,) ou ponto e vírgula (;).`
    };
  }

  if (outOfRange.length > 0) {
    return {
      valid: false,
      numbers: [],
      normalizedText: '',
      error: `Os números devem estar entre 91 e 135 (caderno de Ciências da Natureza). Valores fora do intervalo: ${outOfRange.join(', ')}.`
    };
  }

  if (numbers.length === 0) {
    return { valid: false, numbers: [], normalizedText: '', error: 'Nenhum número válido foi identificado. Insira valores entre 91 e 135.' };
  }

  numbers.sort((a, b) => a - b);
  return { valid: true, numbers, normalizedText: numbers.join(', ') };
}

export default function App() {
  // Inventory of questions in memory
  const [questions, setQuestions] = useState<QuestaoFísica[]>([]);

  // Track selected question IDs for LaTeX compilation
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('Todos');
  const [filterImageOnly, setFilterImageOnly] = useState<boolean>(false);

  // Drag & Drop / Upload PDF Classify State
  const [customExamText, setCustomExamText] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [missingQuestions, setMissingQuestions] = useState<number[]>([]);
  const [extraQuestions, setExtraQuestions] = useState<number[]>([]);
  const [invalidAlternativesQuestions, setInvalidAlternativesQuestions] = useState<number[]>([]);
  const [showSuccessValidation, setShowSuccessValidation] = useState<boolean>(false);
  const [performanceMetrics, setPerformanceMetrics] = useState<any | null>(null);

  // LaTeX preambles & comments toggle
  const [includeComments, setIncludeComments] = useState(true);

  // Edit Modal State
  const [editingQuestion, setEditingQuestion] = useState<QuestaoFísica | null>(null);

  // File selection handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFile(file);
      setPdfFileName(file.name);
      setErrorMessage(null);
    } else {
      setPdfFile(null);
      setPdfFileName(null);
    }
  };

  // Upload and classify with AI
  const handleClassifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) {
      setErrorMessage('Por favor, selecione o arquivo PDF da prova do ENEM antes de processar.');
      return;
    }

    const validation = parseAndValidateQuestionNumbers(customExamText);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Por favor, informe números de questões válidos entre 91 e 135.');
      return;
    }

    setIsClassifying(true);
    setErrorMessage(null);
    setMissingQuestions([]);
    setExtraQuestions([]);
    setInvalidAlternativesQuestions([]);
    setShowSuccessValidation(false);
    setPerformanceMetrics(null);

    const formData = new FormData();
    formData.append('pdfFile', pdfFile);
    formData.append('examText', validation.normalizedText);

    try {
      let res = await fetch('/api/classify', {
        method: 'POST',
        body: formData,
      });

      let responseText = await res.text();
      let contentType = res.headers.get('content-type') || '';
      let isHtmlResponse = contentType.includes('text/html') || responseText.trim().startsWith('<') || responseText.includes('<!doctype') || responseText.includes('<html');

      // Handle server warmup (cold start) retry logic safely, without looping on other API errors
      if (isHtmlResponse && (responseText.includes('Starting Server') || responseText.includes('warmup') || responseText.includes('Vite') || responseText.includes('<html'))) {
        setErrorMessage('O servidor está acordando (Cold Start). Aguardando 4 segundos antes de tentar novamente...');
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        setErrorMessage(null);
        res = await fetch('/api/classify', {
          method: 'POST',
          body: formData,
        });
        responseText = await res.text();
        contentType = res.headers.get('content-type') || '';
        isHtmlResponse = contentType.includes('text/html') || responseText.trim().startsWith('<') || responseText.includes('<!doctype') || responseText.includes('<html');
      }

      if (!res.ok || isHtmlResponse) {
        let errorMsg = 'Erro ao processar com a IA.';

        if (isHtmlResponse) {
          if (res.status === 413 || responseText.includes('too large') || responseText.includes('Entity Too Large')) {
            errorMsg = 'O arquivo PDF enviado é muito grande (excede o limite de transferência). Por favor, envie um PDF menor.';
          } else {
            errorMsg = 'O servidor está concluindo a inicialização. Por favor, tente clicar novamente em Extrair Questões.';
          }
        } else {
          try {
            const errData = JSON.parse(responseText);
            errorMsg = errData.error || errorMsg;
          } catch {
            if (res.status === 413) {
              errorMsg = 'O arquivo PDF enviado é muito grande. Por favor, reduza o tamanho do PDF.';
            } else if (res.status === 429) {
              errorMsg = 'Limite de cota de inteligência artificial temporariamente excedido. Aguarde alguns instantes ou ative o Plano Premium.';
            } else {
              errorMsg = `Erro no servidor (${res.status}). Por favor, tente novamente.`;
            }
          }
        }
        throw new Error(errorMsg);
      }

      let classifiedQuestions: any = null;
      try {
        classifiedQuestions = safeParseJson(responseText);
      } catch (parseErr) {
        console.error('Falha ao converter resposta da IA em JSON:', parseErr, responseText);
        throw new Error('A resposta gerada não pôde ser interpretada como lista de questões. Por favor, tente novamente.');
      }

      let rawList: any[] = [];
      let perf: any = null;

      if (classifiedQuestions && typeof classifiedQuestions === 'object' && !Array.isArray(classifiedQuestions)) {
        if (Array.isArray(classifiedQuestions.questions)) {
          rawList = classifiedQuestions.questions;
        } else {
          rawList = [classifiedQuestions];
        }
        if (classifiedQuestions.performance) {
          perf = classifiedQuestions.performance;
        }
      } else if (Array.isArray(classifiedQuestions)) {
        rawList = classifiedQuestions;
      }

      if (perf) {
        setPerformanceMetrics(perf);
        console.log(
          `%c[PERFORMANCE] Extração Concluída!\n` +
          `-----------------------------------\n` +
          `• Recebimento & Local Split: ${Number(perf.recebimento).toFixed(2)}s\n` +
          `• Upload Gemini Files API:   ${Number(perf.uploadGemini).toFixed(2)}s\n` +
          `• Modelo (generateContent):  ${Number(perf.generateContent).toFixed(2)}s\n` +
          `• Parse e Sanificação JSON:  ${Number(perf.parse).toFixed(2)}s\n` +
          `• Tempo Total Decorrido:     ${Number(perf.total).toFixed(2)}s\n` +
          `-----------------------------------`,
          'color: #0d9488; font-weight: bold; font-size: 13px;'
        );
      }

      if (rawList.length > 0) {
        // Track structurally invalid alternatives in the incoming raw list
        const invalidAlts: number[] = [];

        const mapped = rawList.map((q: any, idx: number) => {
          const origAlts = Array.isArray(q.alternativas) ? q.alternativas : [];
          const origHasExactlyFive = origAlts.length === 5;
          const origHasCorrectLetters = origHasExactlyFive && ['A', 'B', 'C', 'D', 'E'].every((l, i) => {
            const alt = origAlts[i];
            return alt && String(alt.letra || '').toUpperCase() === l;
          });
          const origHasTexts = origAlts.every((alt: any) => alt && String(alt.texto || '').trim() !== '');

          const matchNum = String(q.numero || '').match(/\d+/);
          const qNum = matchNum ? parseInt(matchNum[0], 10) : (idx + 1);

          if (!origHasExactlyFive || !origHasCorrectLetters || !origHasTexts) {
            invalidAlts.push(qNum);
          }

          // Normalize / Heal to exactly [A, B, C, D, E] for UI rendering and safety
          const letters = ['A', 'B', 'C', 'D', 'E'];
          const normalizedAlts = letters.map((l) => {
            const existing = origAlts.find((a: any) => a && String(a.letra || '').toUpperCase() === l);
            return existing ? { letra: l, texto: existing.texto || '' } : { letra: l, texto: '' };
          });

          return {
            ...q,
            id: `custom-${Date.now()}-${idx}`,
            numero: q.numero || `Questão ${qNum}`,
            enunciado: q.enunciado || '',
            tema: q.tema ?? null,
            subtema: q.subtema || '',
            alternativas: normalizedAlts,
            temFigura: typeof q.temFigura === 'boolean' ? q.temFigura : (!!q.figura || false)
          };
        });

        // VERIFY EXTRACTION OF REQUESTED QUESTIONS (EXTRACTION VALIDATOR)
        if (validation.numbers && validation.numbers.length > 0) {
          const missing: number[] = [];
          for (const reqNum of validation.numbers) {
            const isFound = mapped.some((mq: any) => {
              const numStr = String(mq.numero || '');
              const regex = new RegExp(`\\b${reqNum}\\b`);
              return regex.test(numStr);
            });
            if (!isFound) {
              missing.push(reqNum);
            }
          }
          setMissingQuestions(missing);

          const extra: number[] = [];
          for (const mq of mapped) {
            const numStr = String(mq.numero || '');
            const matchNum = numStr.match(/\d+/);
            if (matchNum) {
              const returnedNum = parseInt(matchNum[0], 10);
              if (returnedNum >= 91 && returnedNum <= 135 && !validation.numbers.includes(returnedNum)) {
                if (!extra.includes(returnedNum)) {
                  extra.push(returnedNum);
                }
              }
            }
          }
          setExtraQuestions(extra);
          setInvalidAlternativesQuestions(invalidAlts);
          setShowSuccessValidation(missing.length === 0 && extra.length === 0 && invalidAlts.length === 0);
        } else {
          setMissingQuestions([]);
          setExtraQuestions([]);
          setInvalidAlternativesQuestions([]);
          setShowSuccessValidation(false);
        }

        // Adiciona novas questões ao início e seleciona-as automaticamente
        setQuestions(prev => [...mapped, ...prev]);
        setSelectedIds(prev => [...mapped.map(m => m.id), ...prev]);
        
        // Limpa formulário
        setPdfFile(null);
        setPdfFileName(null);
        return;
      } else {
        setErrorMessage('Nenhuma questão de Física foi identificada no arquivo PDF enviado. Certifique-se de carregar o arquivo correto.');
        return;
      }
    } catch (err: any) {
      console.error(err);
      const isFailedToFetch = String(err?.message || '').toLowerCase().includes('failed to fetch') || String(err).toLowerCase().includes('failed to fetch');
      if (isFailedToFetch) {
        setErrorMessage('A conexão com o servidor oscilou temporariamente ou o arquivo é muito grande. Por favor, tente clicar novamente em "Extrair Questões" para retomar.');
      } else {
        setErrorMessage(err?.message || 'Falha na conexão com o servidor de Inteligência Artificial.');
      }
    } finally {
      setIsClassifying(false);
    }
  };

  // Bulk Operations
  const handleSelectAll = () => {
    setSelectedIds(filteredQuestions.map(q => q.id));
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Inline theme edit handler
  const handleUpdateTheme = (id: string, newTheme: any) => {
    setQuestions(prev => 
      prev.map(q => q.id === id ? { ...q, tema: newTheme } : q)
    );
  };

  // Inline subtheme edit handler
  const handleUpdateSubtheme = (id: string, newSubtheme: string) => {
    setQuestions(prev => 
      prev.map(q => q.id === id ? { ...q, subtema: newSubtheme } : q)
    );
  };

  // Toggle Has Image (temFigura)
  const handleToggleHasImage = (id: string) => {
    setQuestions(prev => 
      prev.map(q => q.id === id ? { ...q, temFigura: !q.temFigura } : q)
    );
  };

  // Delete question from inventory
  const handleDeleteQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
    setSelectedIds(prev => prev.filter(item => item !== id));
  };

  // Edit question text handler
  const handleSaveEdit = (edited: QuestaoFísica) => {
    setQuestions(prev => prev.map(q => q.id === edited.id ? edited : q));
    setEditingQuestion(null);
  };

  // Filtered lists of questions to display in main view
  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
      const matchesTheme = selectedTheme === 'Todos' 
        || (selectedTheme === 'Ausentes' && q.tema === null)
        || q.tema === selectedTheme;
      const matchesSearch = !searchTerm.trim() || 
        q.numero.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.enunciado.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.subtema.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesImage = !filterImageOnly || q.temFigura;
      return matchesTheme && matchesSearch && matchesImage;
    });
  }, [questions, selectedTheme, searchTerm, filterImageOnly]);

  // Selected questions filtered for LaTeX downloads
  const selectedQuestionsForExport = useMemo(() => {
    return questions.filter(q => selectedIds.includes(q.id));
  }, [questions, selectedIds]);

  // Download handlers
  const handleDownloadSingleConsolidated = () => {
    if (selectedQuestionsForExport.length === 0) return;
    const content = generateConsolidatedLatexFile(selectedQuestionsForExport, { includeComments });
    downloadLatexFile('lista_questoes_enem_fisica.tex', content);
  };

  const handleDownloadThemeZip = async () => {
    if (selectedQuestionsForExport.length === 0) return;
    const themeFiles = generateAllThemesFiles(selectedQuestionsForExport, { includeComments });
    await downloadAllThemesZip(themeFiles, 'questoes_enem_fisica_por_tema.zip', selectedQuestionsForExport);
  };

  // Theme Configs (Icons & Colors Matching the Educational Guide)
  const themeMeta: Record<string, { icon: any; color: string; bg: string; border: string }> = {
    'Mecânica': { 
      icon: Gauge, 
      color: 'text-sky-600', 
      bg: 'bg-sky-50', 
      border: 'border-sky-100' 
    },
    'Eletricidade e Magnetismo': { 
      icon: Atom, 
      color: 'text-amber-600', 
      bg: 'bg-amber-50', 
      border: 'border-amber-100' 
    },
    'Termologia': { 
      icon: Flame, 
      color: 'text-rose-600', 
      bg: 'bg-rose-50', 
      border: 'border-rose-100' 
    },
    'Ondulatória': { 
      icon: Tv, 
      color: 'text-indigo-600', 
      bg: 'bg-indigo-50', 
      border: 'border-indigo-100' 
    },
    'Óptica': { 
      icon: Sparkles, 
      color: 'text-emerald-600', 
      bg: 'bg-emerald-50', 
      border: 'border-emerald-100' 
    },
    'Física Moderna': { 
      icon: TrendingUp, 
      color: 'text-purple-600', 
      bg: 'bg-purple-50', 
      border: 'border-purple-100' 
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900 antialiased">
      
      {/* HEADER BAR */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 backdrop-blur-md px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-600 text-white rounded-lg">
            <Atom className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
              Enem<span className="text-indigo-600">Física</span> LaTeX
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">Reorganizador Temático de Provas e Exportador de Exercícios</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
            <Layers size={13} className="text-indigo-500" />
            <span>{questions.length} Questões no Banco</span>
          </span>
        </div>
      </header>

      {/* WORKSPACE CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: Controls, Uploads, Action Downloads (col-span-4) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* UPLOAD & IA CARD */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Upload size={16} className="text-indigo-500" />
                <span>Carregar Nova Prova</span>
              </h2>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Envie o PDF da prova (ou caderno do 2º dia) para categorizar novas questões instantaneamente usando Inteligência Artificial.
              </p>
            </div>

            <form onSubmit={handleClassifySubmit} className="space-y-3.5">
              {/* PDF Drag & Drop */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">PDF Caderno 2º Dia</label>
                <div className="relative border-2 border-dashed border-slate-300 rounded-xl hover:border-indigo-500 transition-colors bg-slate-50/50 hover:bg-slate-50/20">
                  <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    title=""
                  />
                  <div className="p-5 text-center space-y-2">
                    <div className="p-2 bg-white rounded-lg shadow-xs border border-slate-200 max-w-max mx-auto text-slate-400">
                      <FileText size={20} className={pdfFileName ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 truncate max-w-[240px] mx-auto">
                        {pdfFileName || 'Selecionar Arquivo PDF'}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {pdfFileName ? 'Clique ou arraste para trocar' : 'Arraste seu PDF aqui'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Range Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 block">Questões de Ciências da Natureza</label>
                  <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Obrigatório *</span>
                </div>
                <input 
                  type="text" 
                  value={customExamText}
                  onChange={(e) => setCustomExamText(e.target.value)}
                  placeholder="Ex: 95, 102, 115 ou intervalo 91-95"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  disabled={isClassifying}
                />
              </div>

              {/* Action Button */}
              <button
                type="submit"
                disabled={isClassifying || !pdfFile}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition-all shadow-sm active:scale-95 disabled:scale-100 cursor-pointer"
              >
                {isClassifying ? (
                  <>
                    <RefreshCw size={13} className="animate-spin text-indigo-400" />
                    <span>Extraindo e Categorizando...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    <span>Extrair e Organizar Questões</span>
                  </>
                )}
              </button>

              {/* Error Alert */}
              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-700 rounded-lg text-[11px] leading-relaxed flex gap-1.5">
                  <XCircle size={14} className="shrink-0 mt-0.5 text-red-500" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Extraction Validator Alerts */}
              {showSuccessValidation && (
                <div className="p-3 bg-emerald-50 border border-emerald-100 text-emerald-900 rounded-lg text-[11px] leading-relaxed flex flex-col gap-1 shadow-xs">
                  <div className="flex gap-1.5 items-center font-bold text-emerald-800">
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                    <span>Extração Perfeita (100% Válida)</span>
                  </div>
                  <p className="text-slate-600 font-medium text-[10px]">
                    Todas as questões solicitadas foram retornadas com precisão absoluta, sem nenhuma falta ou excedente.
                  </p>
                </div>
              )}

              {(missingQuestions.length > 0 || extraQuestions.length > 0 || invalidAlternativesQuestions.length > 0) && (
                <div className="p-3 bg-amber-50 border border-amber-100 text-amber-900 rounded-lg text-[11px] leading-relaxed flex flex-col gap-2 shadow-xs">
                  <div className="flex gap-1.5 items-center font-bold text-amber-800">
                    <AlertTriangle size={14} className="shrink-0 text-amber-600" />
                    <span>Validação: Divergência Detectada</span>
                  </div>
                  <p className="text-slate-600 font-medium text-[10px] leading-snug">
                    O conjunto de questões retornadas possui pendências ou não corresponde exatamente ao solicitado.
                  </p>
                  
                  {missingQuestions.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-bold text-red-700 block text-[10px]">Faltaram (solicitadas mas não retornadas):</span>
                      <div className="flex flex-wrap gap-1">
                        {missingQuestions.map(num => (
                          <span key={num} className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-mono text-[10px] font-bold border border-red-200/50">
                            Questão {num}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {extraQuestions.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-bold text-amber-700 block text-[10px]">Excedentes (retornadas mas não solicitadas):</span>
                      <div className="flex flex-wrap gap-1">
                        {extraQuestions.map(num => (
                          <span key={num} className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-mono text-[10px] font-bold border border-amber-200/50">
                            Questão {num}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {invalidAlternativesQuestions.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-bold text-red-700 block text-[10px]">⚠ Estrutura de Alternativas Inválida (faltando A-E ou texto em branco):</span>
                      <div className="flex flex-wrap gap-1">
                        {invalidAlternativesQuestions.map(num => (
                          <span key={num} className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-mono text-[10px] font-bold border border-red-200/50">
                            Questão {num}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 leading-normal mt-0.5">
                    *Questões com estrutura inválida ou excedente podem ser excluídas, ou corrigidas manualmente clicando em "Editar" na lista abaixo.
                  </p>
                </div>
              )}

              {/* Performance Metrics Card */}
              {performanceMetrics && (
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg text-[11px] space-y-1.5 shadow-2xs mt-4">
                  <div className="flex gap-1.5 items-center font-bold text-indigo-950">
                    <Clock size={14} className="shrink-0 text-indigo-600" />
                    <span>Métricas de Tempo do Backend</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-600 text-[10px]">
                    <div className="bg-white/60 p-1.5 rounded border border-indigo-100/30">
                      <span className="block text-slate-400 font-medium">Pré-proc. Local:</span>
                      <span className="font-bold text-slate-800">{Number(performanceMetrics.recebimento).toFixed(2)}s</span>
                    </div>
                    <div className="bg-white/60 p-1.5 rounded border border-indigo-100/30">
                      <span className="block text-slate-400 font-medium">Upload Gemini:</span>
                      <span className="font-bold text-slate-800">{Number(performanceMetrics.uploadGemini).toFixed(2)}s</span>
                    </div>
                    <div className="bg-white/60 p-1.5 rounded border border-indigo-100/30">
                      <span className="block text-slate-400 font-medium">IA (Gemini API):</span>
                      <span className="font-bold text-indigo-700">{Number(performanceMetrics.generateContent).toFixed(2)}s</span>
                    </div>
                    <div className="bg-white/60 p-1.5 rounded border border-indigo-100/30">
                      <span className="block text-slate-400 font-medium">Sanificar JSON:</span>
                      <span className="font-bold text-slate-800">{Number(performanceMetrics.parse).toFixed(2)}s</span>
                    </div>
                  </div>
                  <div className="pt-1 border-t border-indigo-100 flex items-center justify-between text-[10px] font-bold text-indigo-900">
                    <span>Tempo Total Decorrido:</span>
                    <span className="px-1.5 py-0.5 bg-indigo-600 text-white rounded">{Number(performanceMetrics.total).toFixed(2)}s</span>
                  </div>
                </div>
              )}
            </form>
          </section>

          {/* DOWNLOAD & EXPORT OPTIONS */}
          <section className="bg-slate-900 rounded-2xl shadow-md p-5 text-white space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <FileCode size={16} className="text-indigo-400" />
                <span>Exportar LaTeX</span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Gere arquivos estruturados prontos para compilar. As figuras conterão comandos de <code className="text-amber-300 font-mono">\includegraphics</code> ativos.
              </p>
            </div>

            {/* Selection Status */}
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Questões Selecionadas:</span>
              <span className="font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                {selectedQuestionsForExport.length} de {questions.length}
              </span>
            </div>

            {/* LaTeX configuration */}
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={includeComments}
                  onChange={(e) => setIncludeComments(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0"
                />
                <span>Incluir comentários estruturais (% Tema / % Subtema)</span>
              </label>
            </div>

            {/* Download Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={handleDownloadThemeZip}
                disabled={selectedQuestionsForExport.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl transition-all shadow-sm active:scale-95 disabled:scale-100 cursor-pointer"
              >
                <FolderArchive size={15} />
                <span>Baixar ZIP (Arquivos por Tema)</span>
              </button>

              <button
                onClick={handleDownloadSingleConsolidated}
                disabled={selectedQuestionsForExport.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white disabled:bg-slate-800 disabled:text-slate-600 disabled:border-transparent rounded-xl transition-all active:scale-95 disabled:scale-100 cursor-pointer"
              >
                <FileDown size={14} />
                <span>Baixar .tex Único (Consolidado)</span>
              </button>
            </div>
          </section>

        </div>

        {/* RIGHT COLUMN: Question Organizer Workspace (col-span-8) */}
        <div className="lg:col-span-8 space-y-4">
          
          {/* SEARCH & FILTERS CONTROLS */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              {/* Search Bar */}
              <div className="relative w-full sm:flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Pesquisar questão por número, enunciado ou subtema..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition-all text-slate-800"
                />
              </div>

              {/* Has image filter */}
              <label className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 hover:bg-slate-100/80 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={filterImageOnly}
                  onChange={(e) => setFilterImageOnly(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-0"
                />
                <ImageIcon size={13} className="text-slate-500" />
                <span>Apenas com Imagem</span>
              </label>
            </div>

            {/* Theme Filter badgelist */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {['Todos', 'Mecânica', 'Eletricidade e Magnetismo', 'Termologia', 'Óptica', 'Ondulatória', 'Física Moderna', 'Ausentes'].map(theme => {
                const isActive = selectedTheme === theme;
                return (
                  <button
                    key={theme}
                    onClick={() => setSelectedTheme(theme)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      isActive 
                        ? 'bg-slate-900 text-white shadow-xs' 
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/50'
                    }`}
                  >
                    {theme}
                  </button>
                );
              })}
            </div>
          </section>

          {/* QUESTIONS INVENTORY TABLE */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            
            {/* Table Actions Header */}
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Questões Filtradas ({filteredQuestions.length})</h3>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={handleSelectAll}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <CheckSquare size={13} />
                  <span>Selecionar Todas</span>
                </button>
                <span className="text-slate-300">|</span>
                <button
                  onClick={handleDeselectAll}
                  className="text-slate-500 hover:text-slate-600 font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Square size={13} />
                  <span>Limpar Seleção</span>
                </button>
              </div>
            </div>

            {/* List Body */}
            {filteredQuestions.length === 0 ? (
              <div className="p-12 text-center space-y-3 flex flex-col items-center justify-center">
                <div className="p-3.5 bg-slate-100 rounded-full text-slate-400">
                  <FileText size={24} />
                </div>
                <div className="space-y-0.5">
                  <h4 className="text-sm font-bold text-slate-700">Nenhuma questão encontrada</h4>
                  <p className="text-xs text-slate-500">Altere seus filtros de busca ou faça upload de um caderno do ENEM para começar.</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/20 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                      <th className="px-5 py-3 w-[48px]">Incluir</th>
                      <th className="px-4 py-3 min-w-[120px]">Questão</th>
                      <th className="px-4 py-3 min-w-[180px]">Temática do ENEM</th>
                      <th className="px-4 py-3 min-w-[150px]">Subtema</th>
                      <th className="px-4 py-3 text-center w-[110px]">Tem Imagem?</th>
                      <th className="px-5 py-3 text-right w-[100px]">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredQuestions.map((q) => {
                      const isSelected = selectedIds.includes(q.id);
                      const meta = q.tema 
                        ? (themeMeta[q.tema] || { icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-100' })
                        : { icon: AlertTriangle, color: 'text-red-500 animate-pulse', bg: 'bg-red-50', border: 'border-red-100' };
                      const ThemeIcon = meta.icon;

                      return (
                        <tr key={q.id} className={`hover:bg-slate-50/60 transition-colors group ${isSelected ? 'bg-indigo-50/10' : ''} ${!q.tema ? 'bg-red-50/5 hover:bg-red-50/10' : ''}`}>
                          
                          {/* Selector */}
                          <td className="px-5 py-3.5">
                            <input 
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(q.id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-0 h-4.5 w-4.5 cursor-pointer"
                              title="Incluir na lista de exportação"
                            />
                          </td>

                          {/* Question Name */}
                          <td className="px-4 py-3.5">
                            <div className="space-y-1">
                              <span className="inline-flex text-xs font-bold text-slate-800">
                                {q.numero}
                              </span>
                              <p className="text-[10px] text-slate-400 font-medium truncate max-w-[180px]">
                                {q.enunciado}
                              </p>
                            </div>
                          </td>

                          {/* Theme Selector Dropdown */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <ThemeIcon size={12} className={`${meta.color} shrink-0`} />
                              <select
                                value={q.tema || ''}
                                onChange={(e) => handleUpdateTheme(q.id, e.target.value === '' ? null : e.target.value as any)}
                                className={`text-xs font-semibold border rounded-md py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer ${
                                  q.tema 
                                    ? 'text-slate-700 bg-slate-50 hover:bg-slate-100 border-slate-200' 
                                    : 'text-red-700 bg-red-50 hover:bg-red-100/80 border-red-200 font-bold'
                                }`}
                              >
                                <option value="">⚠ Classificação Ausente</option>
                                {['Mecânica', 'Eletricidade e Magnetismo', 'Termologia', 'Óptica', 'Ondulatória', 'Física Moderna'].map(themeOption => (
                                  <option key={themeOption} value={themeOption}>{themeOption}</option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* Subtheme text field */}
                          <td className="px-4 py-3.5">
                            <input 
                              type="text"
                              value={q.subtema}
                              onChange={(e) => handleUpdateSubtheme(q.id, e.target.value)}
                              placeholder="Editar subtema..."
                              className="text-xs font-medium text-slate-700 bg-transparent hover:bg-slate-50 focus:bg-white border border-transparent hover:border-slate-200 focus:border-slate-300 rounded-md py-1 px-1.5 w-full focus:outline-none transition-all"
                            />
                          </td>

                          {/* Image Selector toggle switch */}
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex flex-col items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleHasImage(q.id)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-extrabold tracking-wide uppercase rounded-md border transition-all cursor-pointer ${
                                  q.temFigura
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-slate-100 text-slate-400 border-transparent hover:border-slate-200'
                                }`}
                              >
                                <ImageIcon size={10} className={q.temFigura ? 'text-amber-500' : 'text-slate-400'} />
                                <span>{q.temFigura ? 'Sim' : 'Não'}</span>
                              </button>

                              {q.temFigura && q.figuraBase64 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const numMatch = q.numero.match(/\d+/);
                                    const numStr = numMatch ? numMatch[0] : q.id;
                                    const linkSource = `data:application/pdf;base64,${q.figuraBase64}`;
                                    const downloadLink = document.createElement("a");
                                    downloadLink.href = linkSource;
                                    downloadLink.download = `figura_questao_${numStr}.pdf`;
                                    downloadLink.click();
                                  }}
                                  className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded border border-indigo-100/40 cursor-pointer"
                                  title="Baixar figura vetorizada (.pdf)"
                                >
                                  <FileDown size={10} />
                                  <span>Baixar Vetor</span>
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Actions: Edit, Delete */}
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setEditingQuestion(q)}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                                title="Editar texto da questão"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteQuestion(q.id)}
                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                title="Remover questão"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </div>
      </main>

      {/* EDITING DIALOG MODAL */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full flex flex-col max-h-[88vh] overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Edit className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-bold tracking-tight">Editar Conteúdo da {editingQuestion.numero}</h3>
              </div>
              <button 
                onClick={() => setEditingQuestion(null)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer text-xs font-semibold"
              >
                Cancelar
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Question identity */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Identificador / Número</label>
                  <input 
                    type="text" 
                    value={editingQuestion.numero}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, numero: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Subtema</label>
                  <input 
                    type="text" 
                    value={editingQuestion.subtema}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, subtema: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Enunciado text editor */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">Texto do Enunciado</label>
                <textarea 
                  value={editingQuestion.enunciado}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, enunciado: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed font-sans"
                />
              </div>

              {/* Alternatives editor */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase block">Alternativas</label>
                {['A', 'B', 'C', 'D', 'E'].map((letter, idx) => {
                  const altObj = editingQuestion.alternativas[idx] || { letra: letter, texto: '' };
                  return (
                    <div key={letter} className="flex items-center gap-2">
                      <span className="w-6 h-6 shrink-0 inline-flex items-center justify-center text-xs font-bold bg-slate-100 border border-slate-200 rounded-md text-slate-600">
                        {letter}
                      </span>
                      <input 
                        type="text"
                        value={altObj.texto}
                        onChange={(e) => {
                          const newAlts = [...editingQuestion.alternativas];
                          newAlts[idx] = { letra: letter, texto: e.target.value };
                          setEditingQuestion({ ...editingQuestion, alternativas: newAlts });
                        }}
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder={`Texto da alternativa ${letter}...`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
              <button 
                onClick={() => setEditingQuestion(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                Descartar
              </button>
              <button 
                onClick={() => handleSaveEdit(editingQuestion)}
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm cursor-pointer"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
