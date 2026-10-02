/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  Atom, 
  Sparkles, 
  Flame, 
  Tv, 
  TrendingUp, 
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
  RefreshCw,
  Clock,
  Layers,
  FileDown,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { QuestaoFísica } from './types';
import { 
  generateAllThemesFiles, 
  downloadLatexFile, 
  downloadAllThemesZip, 
  generateConsolidatedLatexFile 
} from './latexExporter';

// Helper to parse and validate ENEM question numbers (e.g. 91 to 135)
function parseAndValidateQuestionNumbers(input: string): { valid: boolean; numbers: number[]; normalizedText: string; error?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, numbers: [], normalizedText: '', error: 'Por favor, informe ao menos um número de questão (ex: 95 ou intervalo 91 a 105).' };
  }

  // Support range syntax like "91 a 105", "91-105", "91 até 105"
  const rangeMatch = trimmed.match(/^(\d{2,3})\s*(?:a|até|-)\s*(\d{2,3})$/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (isNaN(start) || isNaN(end) || start > end) {
      return { 
        valid: false, 
        numbers: [], 
        normalizedText: '',
        error: 'Intervalo inválido. O valor inicial deve ser menor que o final (ex: 91 a 105).' 
      };
    }
    const numbers: number[] = [];
    for (let i = start; i <= end; i++) numbers.push(i);
    return { valid: true, numbers, normalizedText: numbers.join(', ') };
  }

  // Split tokens by space, comma, semicolon, newline or tabs
  const rawTokens = trimmed.split(/[\s,;]+/).filter(Boolean);
  if (rawTokens.length === 0) {
    return { valid: false, numbers: [], normalizedText: '', error: 'Por favor, informe os números das questões.' };
  }

  const numbers: number[] = [];
  const invalidTokens: string[] = [];

  for (const token of rawTokens) {
    if (/^\d{2,3}-\d{2,3}$/.test(token)) {
      const [sStr, eStr] = token.split('-');
      const s = parseInt(sStr, 10);
      const e = parseInt(eStr, 10);
      if (!isNaN(s) && !isNaN(e) && s <= e) {
        for (let i = s; i <= e; i++) {
          if (!numbers.includes(i)) numbers.push(i);
        }
      }
      continue;
    }

    const num = parseInt(token, 10);
    if (isNaN(num) || !/^\d+$/.test(token)) {
      invalidTokens.push(token);
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
      error: `Formato inválido: "${invalidTokens.join(', ')}". Use números separados por vírgula ou espaço (ex: 91, 92, 93).`
    };
  }

  if (numbers.length === 0) {
    return { valid: false, numbers: [], normalizedText: '', error: 'Nenhum número válido foi identificado.' };
  }

  numbers.sort((a, b) => a - b);
  return { valid: true, numbers, normalizedText: numbers.join(', ') };
}

export default function App() {
  const [questions, setQuestions] = useState<QuestaoFísica[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('Todos');
  const [filterImageOnly, setFilterImageOnly] = useState<boolean>(false);

  // Form & Process State
  const [customExamText, setCustomExamText] = useState<string>('91 a 105');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Validation & Performance Metrics
  const [missingQuestions, setMissingQuestions] = useState<number[]>([]);
  const [invalidAlternativesQuestions, setInvalidAlternativesQuestions] = useState<number[]>([]);
  const [showSuccessValidation, setShowSuccessValidation] = useState<boolean>(false);
  const [performanceTotal, setPerformanceTotal] = useState<number | null>(null);

  // LaTeX export options
  const [includeComments, setIncludeComments] = useState(true);

  // Edit Modal State
  const [editingQuestion, setEditingQuestion] = useState<QuestaoFísica | null>(null);

  // PNG Figure Downloader State
  const [downloadingPngId, setDownloadingPngId] = useState<string | null>(null);

  const handleDownloadPng = async (base64Data: string, numeroStr: string, questionId: string) => {
    setDownloadingPngId(questionId);
    try {
      if (!(window as any).pdfjsLib) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Falha ao carregar renderizador de imagem.'));
          document.head.appendChild(script);
        });
      }

      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const loadingTask = pdfjsLib.getDocument({ data: bytes });
      const pdfDoc = await loadingTask.promise;
      const page = await pdfDoc.getPage(1);

      const viewport = page.getViewport({ scale: 3.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível inicializar canvas');

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      const pngUrl = canvas.toDataURL('image/png');
      const numMatch = numeroStr.match(/\d+/);
      const numOnly = numMatch ? numMatch[0] : numeroStr;
      const downloadLink = document.createElement('a');
      downloadLink.href = pngUrl;
      downloadLink.download = `figura_questao_${numOnly}.png`;
      downloadLink.click();
    } catch (err) {
      console.warn('[PNG Download] Erro ao converter para PNG. Baixando PDF vetorial:', err);
      const numMatch = numeroStr.match(/\d+/);
      const numOnly = numMatch ? numMatch[0] : numeroStr;
      const downloadLink = document.createElement('a');
      downloadLink.href = `data:application/pdf;base64,${base64Data}`;
      downloadLink.download = `figura_questao_${numOnly}.pdf`;
      downloadLink.click();
    } finally {
      setDownloadingPngId(null);
    }
  };

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

  // Submit handler: Processamento Local + Classificação IA
  const handleExtractSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) {
      setErrorMessage('Por favor, selecione o arquivo PDF da prova do ENEM.');
      return;
    }

    const validation = parseAndValidateQuestionNumbers(customExamText);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Informe números válidos de questão.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setMissingQuestions([]);
    setInvalidAlternativesQuestions([]);
    setShowSuccessValidation(false);
    setPerformanceTotal(null);

    const formData = new FormData();
    formData.append('pdfFile', pdfFile);
    formData.append('examText', validation.normalizedText);

    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Falha no processamento (${res.status})`);
      }

      const data = await res.json();
      const extractedList: QuestaoFísica[] = data.questions || [];
      const missingList: number[] = data.missing || [];

      // Validar estrutura das alternativas
      const invalidAltsList: number[] = [];
      for (const q of extractedList) {
        const hasFive = Array.isArray(q.alternativas) && q.alternativas.length === 5;
        const allHaveText = hasFive && q.alternativas.every(a => a && a.texto && a.texto.trim().length > 0);
        if (!hasFive || !allHaveText) {
          const match = q.numero.match(/\d+/);
          if (match) invalidAltsList.push(parseInt(match[0], 10));
        }
      }

      // Adicionar novas questões ao inventário
      setQuestions(prev => {
        const existingIds = new Set(prev.map(q => q.numero));
        const filteredNew = extractedList.filter(q => !existingIds.has(q.numero));
        return [...filteredNew, ...prev];
      });

      // Selecionar as questões recém-extraídas para exportação
      setSelectedIds(prev => {
        const newIds = extractedList.map(q => q.id);
        return Array.from(new Set([...newIds, ...prev]));
      });

      setMissingQuestions(missingList);
      setInvalidAlternativesQuestions(invalidAltsList);
      if (data.performance?.total) {
        setPerformanceTotal(data.performance.total);
      }

      if (missingList.length === 0 && invalidAltsList.length === 0 && extractedList.length > 0) {
        setShowSuccessValidation(true);
      }

    } catch (err: any) {
      console.error('[Extract Error]:', err);
      setErrorMessage(err.message || 'Erro ao processar as questões do ENEM.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Bulk Selection
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

  // Question editing
  const handleUpdateTheme = (id: string, newTheme: any) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, tema: newTheme } : q));
  };

  const handleUpdateSubtheme = (id: string, newSubtheme: string) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, subtema: newSubtheme } : q));
  };

  const handleToggleHasImage = (id: string) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, temFigura: !q.temFigura } : q));
  };

  const handleDeleteQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
    setSelectedIds(prev => prev.filter(item => item !== id));
  };

  const handleSaveEdit = (edited: QuestaoFísica) => {
    setQuestions(prev => prev.map(q => q.id === edited.id ? edited : q));
    setEditingQuestion(null);
  };

  // Filtered questions
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

  // Theme Configs
  const themeMeta: Record<string, { icon: any; color: string }> = {
    'Mecânica': { icon: Gauge, color: 'text-sky-600' },
    'Eletricidade e Magnetismo': { icon: Atom, color: 'text-amber-600' },
    'Termologia': { icon: Flame, color: 'text-rose-600' },
    'Ondulatória': { icon: Tv, color: 'text-indigo-600' },
    'Óptica': { icon: Sparkles, color: 'text-emerald-600' },
    'Física Moderna': { icon: TrendingUp, color: 'text-purple-600' }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900 antialiased">
      
      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 backdrop-blur-md px-6 py-4 flex items-center justify-between shrink-0 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-600 text-white rounded-lg shadow-xs">
            <Atom className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
              Enem<span className="text-indigo-600">Física</span> LaTeX
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">Extração Local do PDF & Classificador Temático com Exportação LaTeX</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
            <Layers size={13} className="text-indigo-500" />
            <span>{questions.length} Questões no Banco</span>
          </span>
        </div>
      </header>

      {/* WORKSPACE */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: Controls & Upload */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* UPLOAD & LOCAL EXTRACTION CARD */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Upload size={16} className="text-indigo-500" />
                <span>Carregar Caderno ENEM</span>
              </h2>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                O servidor separa o texto, as 5 alternativas e as figuras localmente no PDF, usando IA apenas para classificar o tema.
              </p>
            </div>

            <form onSubmit={handleExtractSubmit} className="space-y-3.5">
              {/* PDF Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Arquivo PDF da Prova</label>
                <div className="relative border-2 border-dashed border-slate-300 rounded-xl hover:border-indigo-500 transition-colors bg-slate-50/50 hover:bg-slate-50/20">
                  <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    title=""
                  />
                  <div className="p-4 text-center space-y-2">
                    <div className="p-2 bg-white rounded-lg shadow-xs border border-slate-200 max-w-max mx-auto text-slate-400">
                      <FileText size={20} className={pdfFileName ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 truncate max-w-[240px] mx-auto">
                        {pdfFileName || 'Selecionar Arquivo PDF'}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {pdfFileName ? 'Clique ou arraste para trocar o arquivo' : 'Arraste o arquivo PDF aqui'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Range Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 block">Questões a Extrair</label>
                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">Rápido & Determinístico</span>
                </div>
                <input 
                  type="text" 
                  value={customExamText}
                  onChange={(e) => setCustomExamText(e.target.value)}
                  placeholder="Ex: 91 a 105 ou 95, 102, 115"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono shadow-2xs"
                  disabled={isProcessing}
                />
                <p className="text-[10px] text-slate-400">
                  Aceita intervalos (ex: 91 a 105) ou números avulsos separados por vírgula.
                </p>
              </div>

              {/* Action Button */}
              <button
                type="submit"
                disabled={isProcessing || !pdfFile}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition-all shadow-sm active:scale-95 disabled:scale-100 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw size={13} className="animate-spin text-white" />
                    <span>Processando e Classificando...</span>
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

              {/* Extraction Validation Badges */}
              {showSuccessValidation && (
                <div className="p-3 bg-emerald-50 border border-emerald-100 text-emerald-900 rounded-lg text-[11px] leading-relaxed flex flex-col gap-1 shadow-xs">
                  <div className="flex gap-1.5 items-center font-bold text-emerald-800">
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                    <span>Extração 100% Válida</span>
                  </div>
                  <p className="text-slate-600 font-medium text-[10px]">
                    Todas as questões solicitadas foram separadas com enunciado, 5 alternativas e imagens!
                  </p>
                </div>
              )}

              {(missingQuestions.length > 0 || invalidAlternativesQuestions.length > 0) && (
                <div className="p-3 bg-amber-50 border border-amber-100 text-amber-900 rounded-lg text-[11px] leading-relaxed flex flex-col gap-2 shadow-xs">
                  <div className="flex gap-1.5 items-center font-bold text-amber-800">
                    <AlertTriangle size={14} className="shrink-0 text-amber-600" />
                    <span>Atenção: Validação de Estrutura</span>
                  </div>
                  
                  {missingQuestions.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-bold text-red-700 block text-[10px]">Não encontradas no PDF:</span>
                      <div className="flex flex-wrap gap-1">
                        {missingQuestions.map(num => (
                          <span key={num} className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-mono text-[10px] font-bold">
                            Questão {num}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {invalidAlternativesQuestions.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-bold text-amber-800 block text-[10px]">Alternativas incompletas (necessário revisar):</span>
                      <div className="flex flex-wrap gap-1">
                        {invalidAlternativesQuestions.map(num => (
                          <span key={num} className="px-1.5 py-0.5 bg-amber-100 text-amber-900 rounded font-mono text-[10px] font-bold">
                            Questão {num}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Performance Indicator */}
              {performanceTotal !== null && (
                <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-lg text-[11px] flex items-center justify-between text-slate-600">
                  <span className="flex items-center gap-1 font-medium">
                    <Clock size={13} className="text-indigo-500" />
                    Tempo de Processamento:
                  </span>
                  <span className="font-bold text-slate-800 font-mono">{performanceTotal.toFixed(2)}s</span>
                </div>
              )}
            </form>
          </section>

          {/* LATEX & ZIP EXPORT */}
          <section className="bg-slate-900 rounded-2xl shadow-md p-5 text-white space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <FileCode size={16} className="text-indigo-400" />
                <span>Exportar para LaTeX</span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Gere arquivos estruturados com <code className="text-amber-300 font-mono">\questao</code>, <code className="text-amber-300 font-mono">\begin&#123;alternativas&#125;</code> e imagens recortadas.
              </p>
            </div>

            {/* Selection Counter */}
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Questões Selecionadas:</span>
              <span className="font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                {selectedQuestionsForExport.length} de {questions.length}
              </span>
            </div>

            {/* LaTeX Comments Toggle */}
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={includeComments}
                  onChange={(e) => setIncludeComments(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0"
                />
                <span>Incluir comentários de tema (% Tema / % Subtema)</span>
              </label>
            </div>

            {/* Export Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={handleDownloadThemeZip}
                disabled={selectedQuestionsForExport.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl transition-all shadow-sm active:scale-95 disabled:scale-100 cursor-pointer"
              >
                <FolderArchive size={15} />
                <span>Baixar ZIP (Arquivos por Tema + Figuras PNG)</span>
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

        {/* RIGHT COLUMN: Table & Editor */}
        <div className="lg:col-span-8 space-y-4">
          
          {/* SEARCH & FILTERS */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              {/* Search Bar */}
              <div className="relative w-full sm:flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Pesquisar por número, enunciado ou subtema..."
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

            {/* Theme filter tabs */}
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

          {/* TABLE OF QUESTIONS */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            
            {/* Header controls */}
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
                  <p className="text-xs text-slate-500">Envie o PDF do ENEM acima para extrair e classificar as questões automaticamente.</p>
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
                      const meta = q.tema ? themeMeta[q.tema] : null;
                      const ThemeIcon = meta ? meta.icon : AlertTriangle;

                      return (
                        <tr key={q.id} className={`hover:bg-slate-50/60 transition-colors group ${isSelected ? 'bg-indigo-50/10' : ''}`}>
                          
                          {/* Checkbox */}
                          <td className="px-5 py-3.5">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => handleToggleSelect(q.id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-0 h-4.5 w-4.5 cursor-pointer"
                              title="Incluir na lista de exportação"
                            />
                          </td>

                          {/* Identifier & Snippet */}
                          <td className="px-4 py-3.5">
                            <div className="space-y-1">
                              <span className="inline-flex text-xs font-bold text-slate-800">
                                {q.numero}
                              </span>
                              <p className="text-[10px] text-slate-400 font-medium truncate max-w-[200px]">
                                {q.enunciado}
                              </p>
                            </div>
                          </td>

                          {/* Theme dropdown */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <ThemeIcon size={12} className={`${meta ? meta.color : 'text-red-500'} shrink-0`} />
                              <select
                                value={q.tema || ''}
                                onChange={(e) => handleUpdateTheme(q.id, e.target.value === '' ? null : e.target.value as any)}
                                className={`text-xs font-semibold border rounded-md py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer ${
                                  q.tema 
                                    ? 'text-slate-700 bg-slate-50 hover:bg-slate-100 border-slate-200' 
                                    : 'text-red-700 bg-red-50 hover:bg-red-100/80 border-red-200 font-bold'
                                }`}
                              >
                                <option value="">⚠ Não-Física / Outra Matéria</option>
                                {['Mecânica', 'Eletricidade e Magnetismo', 'Termologia', 'Óptica', 'Ondulatória', 'Física Moderna'].map(themeOption => (
                                  <option key={themeOption} value={themeOption}>{themeOption}</option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* Subtheme input */}
                          <td className="px-4 py-3.5">
                            <input 
                              type="text" 
                              value={q.subtema}
                              onChange={(e) => handleUpdateSubtheme(q.id, e.target.value)}
                              placeholder="Subtema..."
                              className="text-xs font-medium text-slate-700 bg-transparent hover:bg-slate-50 focus:bg-white border border-transparent hover:border-slate-200 focus:border-slate-300 rounded-md py-1 px-1.5 w-full focus:outline-none transition-all"
                            />
                          </td>

                          {/* Has Image & Crop Download */}
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
                                  onClick={() => handleDownloadPng(q.figuraBase64!, q.numero, q.id)}
                                  disabled={downloadingPngId === q.id}
                                  className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 hover:text-amber-900 transition-colors bg-amber-50 hover:bg-amber-100 disabled:opacity-55 px-1.5 py-0.5 rounded border border-amber-200/50 cursor-pointer"
                                  title="Baixar figura recortada (.png)"
                                >
                                  {downloadingPngId === q.id ? (
                                    <RefreshCw size={9} className="animate-spin text-amber-500" />
                                  ) : (
                                    <FileDown size={9} />
                                  )}
                                  <span>Baixar PNG</span>
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setEditingQuestion(q)}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                                title="Editar questão"
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

      {/* EDIT MODAL */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full flex flex-col max-h-[88vh] overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Edit className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-bold tracking-tight">Editar {editingQuestion.numero}</h3>
              </div>
              <button 
                onClick={() => setEditingQuestion(null)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer text-xs font-semibold"
              >
                Cancelar
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Identificador</label>
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

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">Texto do Enunciado</label>
                <textarea 
                  value={editingQuestion.enunciado}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, enunciado: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed font-sans"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase block">5 Alternativas (A a E)</label>
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
