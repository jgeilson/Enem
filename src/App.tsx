/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Atom, 
  Sparkles, 
  Flame, 
  Tv, 
  TrendingUp, 
  BookOpen, 
  CheckCircle, 
  XCircle, 
  Upload, 
  HelpCircle, 
  ChevronRight, 
  FileText,
  Gauge,
  Info,
  FileCode,
  Table as TableIcon,
  LineChart,
  Image as ImageIcon,
  Zap,
  Layers,
  Eye,
  Activity,
  Compass
} from 'lucide-react';
import { QuestaoFísica } from './types';
import { INITIAL_QUESTIONS } from './initialQuestions';
import { LatexExportModal } from './components/LatexExportModal';
import { safeParseJson } from './utils/safeJson';

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
    // Handle sub-ranges if any token contains hyphen like "95-98"
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
  // Application State
  const [questions, setQuestions] = useState<QuestaoFísica[]>(INITIAL_QUESTIONS);
  const [selectedTheme, setSelectedTheme] = useState<string>('Todos');
  const [filterVisual, setFilterVisual] = useState<'all' | 'table' | 'figure'>('all');
  const [activeQuestionId, setActiveQuestionId] = useState<string>(INITIAL_QUESTIONS[0]?.id || '');
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answerEvaluated, setAnswerEvaluated] = useState<boolean>(false);
  const [showResolution, setShowResolution] = useState<boolean>(false);
  
  // Custom Classify State
  const [customExamText, setCustomExamText] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<{ data: string; mimeType: string } | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [showClassifyModal, setShowClassifyModal] = useState<boolean>(false);
  const [showLatexModal, setShowLatexModal] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // File selection handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFileName(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64String = reader.result.split(',')[1];
          setPdfFile({
            data: base64String,
            mimeType: file.type
          });
          setErrorMessage(null);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setPdfFile(null);
      setPdfFileName(null);
    }
  };

  // Active Question Object
  const activeQuestion = questions.find(q => q.id === activeQuestionId) || questions[0];

  // Reset answer states when active question changes
  useEffect(() => {
    if (activeQuestion) {
      setSelectedAnswer(null);
      setAnswerEvaluated(false);
      setShowResolution(false);
    }
  }, [activeQuestionId]);

  // Submit Answer Handlers
  const handleAnswerSelect = (letra: string) => {
    if (!answerEvaluated) {
      setSelectedAnswer(letra);
    }
  };

  const evaluateAnswer = () => {
    if (selectedAnswer) {
      setAnswerEvaluated(true);
      setShowResolution(true);
    }
  };

  // Call Express API to classify user-pasted exam text or uploaded PDF
  const handleClassifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) {
      setErrorMessage('Por favor, selecione o arquivo PDF da prova do ENEM.');
      return;
    }

    const validation = parseAndValidateQuestionNumbers(customExamText);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Por favor, informe números de questões válidos entre 91 e 135.');
      return;
    }

    setIsClassifying(true);
    setErrorMessage(null);

    const maxAttempts = 3;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch('/api/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              examText: validation.normalizedText,
              pdfFile: pdfFile
            }),
          });

          const responseText = await res.text();
          const contentType = res.headers.get('content-type') || '';
          const isHtmlResponse = contentType.includes('text/html') || responseText.trim().startsWith('<') || responseText.includes('<!doctype') || responseText.includes('<html');

          if (!res.ok || isHtmlResponse) {
            let errorMsg = 'Erro ao processar com a IA.';

            if (isHtmlResponse) {
              const isWarmup = responseText.includes('Starting Server') || responseText.includes('warmup') || responseText.includes('Vite') || responseText.includes('<html');
              if (isWarmup && attempt < maxAttempts) {
                // Wait 2 seconds and retry automatically
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
              }
              if (res.status === 413 || responseText.includes('too large') || responseText.includes('Entity Too Large')) {
                errorMsg = 'O arquivo PDF enviado é muito grande (excede o limite de transferência). Por favor, tente enviar um PDF menor.';
              } else {
                errorMsg = 'O servidor está concluindo a inicialização. Por favor, tente clicar novamente em Extrair Questões.';
              }
            } else {
              try {
                const errData = JSON.parse(responseText);
                errorMsg = errData.error || errorMsg;
              } catch {
                if (res.status === 413) {
                  errorMsg = 'O arquivo PDF enviado é muito grande. Por favor, tente enviar um PDF com tamanho menor.';
                } else if (res.status === 429) {
                  errorMsg = 'Limite de cota da API atingido temporariamente. Aguarde alguns instantes e tente novamente.';
                } else if ((res.status === 503 || res.status === 502 || res.status === 504) && attempt < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  continue;
                } else {
                  errorMsg = `Erro no servidor (${res.status}). Por favor, tente novamente em instantes.`;
                }
              }
            }
            throw new Error(errorMsg);
          }

          let classifiedQuestions: any[] = [];
          try {
            classifiedQuestions = safeParseJson(responseText);
          } catch (parseErr) {
            console.error('Falha ao converter resposta da IA em JSON:', parseErr, responseText);
            throw new Error('A resposta gerada não pôde ser interpretada como lista de questões. Por favor, tente novamente.');
          }

          let rawList: any[] = [];
          if (Array.isArray(classifiedQuestions)) {
            rawList = classifiedQuestions;
          } else if (classifiedQuestions && Array.isArray((classifiedQuestions as any).questions)) {
            rawList = (classifiedQuestions as any).questions;
          } else if (classifiedQuestions && typeof classifiedQuestions === 'object') {
            rawList = [classifiedQuestions];
          }

          if (rawList.length > 0) {
            // Normalize each question structure safely
            const mapped = rawList.map((q: any, idx: number) => ({
              ...q,
              id: `custom-${Date.now()}-${idx}`,
              numero: q.numero || `Questão ${idx + 1}`,
              enunciado: q.enunciado || '',
              tema: q.tema || 'Mecânica',
              subtema: q.subtema || '',
              alternativas: Array.isArray(q.alternativas) ? q.alternativas : [],
              gabarito: q.gabarito || 'A',
              resolucao: q.resolucao || '',
              formulas: Array.isArray(q.formulas) ? q.formulas : [],
              tabela: q.tabela && (Array.isArray(q.tabela.cabecalho) || Array.isArray(q.tabela.linhas)) ? {
                titulo: q.tabela.titulo || '',
                cabecalho: Array.isArray(q.tabela.cabecalho) ? q.tabela.cabecalho : [],
                linhas: Array.isArray(q.tabela.linhas) ? q.tabela.linhas.map((r: any) => Array.isArray(r) ? r : [String(r)]) : [],
                legenda: q.tabela.legenda || ''
              } : undefined,
              figura: q.figura && (q.figura.tipo || q.figura.descricao || q.figura.titulo) ? {
                tipo: q.figura.tipo || 'Ilustração',
                titulo: q.figura.titulo || '',
                descricao: q.figura.descricao || '',
                dadosVisuais: Array.isArray(q.figura.dadosVisuais) ? q.figura.dadosVisuais : [],
                legenda: q.figura.legenda || ''
              } : undefined
            }));

            setQuestions(prev => [...mapped, ...prev]);
            if (mapped[0]?.id) {
              setActiveQuestionId(mapped[0].id);
            }
            setShowClassifyModal(false);
            setPdfFile(null);
            setPdfFileName(null);
            return; // Successful extraction
          } else {
            setErrorMessage('Nenhuma questão de Física foi identificada no arquivo PDF enviado. Certifique-se de que o documento contém a prova de Ciências da Natureza do segundo dia.');
            return;
          }
        } catch (err: any) {
          if (attempt === maxAttempts) {
            console.error(err);
            setErrorMessage(err?.message || 'Falha na conexão com o servidor. Verifique se a chave de API está configurada.');
          }
        }
      }
    } finally {
      setIsClassifying(false);
    }
  };

  // Filtering Logic
  const filteredQuestions = questions.filter(q => {
    const matchesTheme = selectedTheme === 'Todos' || q.tema === selectedTheme;
    const matchesVisual = 
      filterVisual === 'all' 
        ? true 
        : filterVisual === 'table' 
          ? !!q.tabela 
          : !!q.figura;
    return matchesTheme && matchesVisual;
  });

  const getFiguraIcon = (tipo?: string) => {
    switch (tipo) {
      case 'Gráfico':
        return <LineChart size={18} />;
      case 'Circuito elétrico':
        return <Zap size={18} />;
      case 'Diagrama óptico':
        return <Eye size={18} />;
      case 'Esquema mecânico':
        return <Layers size={18} />;
      case 'Ondas/Oscilações':
        return <Activity size={18} />;
      case 'Ilustração experimental':
        return <Compass size={18} />;
      default:
        return <ImageIcon size={18} />;
    }
  };

  // Theme Configs (Icons & Colors Matching the Educational Guide)
  const themeMeta: Record<string, { icon: any; color: string; bg: string; border: string }> = {
    'Mecânica': { 
      icon: Gauge, 
      color: 'text-sky-600', 
      bg: 'bg-sky-50/50', 
      border: 'border-sky-100' 
    },
    'Eletricidade e Magnetismo': { 
      icon: Atom, 
      color: 'text-amber-600', 
      bg: 'bg-amber-50/50', 
      border: 'border-amber-100' 
    },
    'Termologia': { 
      icon: Flame, 
      color: 'text-rose-600', 
      bg: 'bg-rose-50/50', 
      border: 'border-rose-100' 
    },
    'Ondulatória': { 
      icon: Tv, 
      color: 'text-indigo-600', 
      bg: 'bg-indigo-50/50', 
      border: 'border-indigo-100' 
    },
    'Óptica': { 
      icon: Sparkles, 
      color: 'text-emerald-600', 
      bg: 'bg-emerald-50/50', 
      border: 'border-emerald-100' 
    },
    'Física Moderna': { 
      icon: TrendingUp, 
      color: 'text-purple-600', 
      bg: 'bg-purple-50/50', 
      border: 'border-purple-100' 
    }
  };


  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900 antialiased">
      
      {/* HEADER: Strict One-Row Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 backdrop-blur-md px-6 py-4 flex items-center justify-between shrink-0">
        {/* Zone 1: Brand title, single line, display face */}
        <div className="flex items-center gap-2">
          <Atom className="h-6 w-6 text-indigo-600" />
          <a href="/" className="text-xl font-bold tracking-tight text-slate-900 font-sans">
            Enem<span className="text-indigo-600 font-extrabold">Física</span>
          </a>
        </div>

        {/* Zone 2: 4-6 nav links, 1-2 word labels, single-line */}
        <nav className="hidden lg:flex items-center gap-8 text-sm font-semibold text-slate-600">
          
          <a href="#resolucoes" className="hover:text-indigo-600 transition-colors whitespace-nowrap">Resoluções Didáticas</a>
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => setShowLatexModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-xs active:scale-95 whitespace-nowrap cursor-pointer"
            title="Exportar questões formatadas em arquivos LaTeX separados por tema"
          >
            <FileCode size={14} className="text-indigo-600" />
            <span>Exportar LaTeX</span>
          </button>
          <button 
            onClick={() => setShowClassifyModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-all shadow-sm active:scale-95 whitespace-nowrap cursor-pointer"
          >
            <Upload size={14} />
            Nova Prova
          </button>
        </div>
      </header>

      {/* SUB-HEADER / WELCOME BANNER (Hero Section) */}
      <section className="bg-gradient-to-r from-indigo-900 via-slate-900 to-slate-900 text-white px-8 py-10 text-center md:text-left relative overflow-hidden shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-white" style={{ textWrap: 'balance' }}>
              Questões de Física do ENEM
            </h1>
          </div>
        </div>
        {/* Decorative background grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-30" />
      </section>

      {/* MAIN TWO-ZONE PLAYGROUND LAYOUT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT PANEL: Provas, Categorias & Question Selector (35% width / col-span-4) */}
        <section className="lg:col-span-4 space-y-6">
          
          {/* Theme Segmented Filter buttons (Interactive segmented control with click handlers) */}
          <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm space-y-3">
            <div>
              <span className="text-xs font-bold text-slate-500 tracking-wider block mb-1.5">FILTRAR POR TEMÁTICA</span>
              <div className="grid grid-cols-2 gap-1.5">
                {['Todos', 'Mecânica', 'Eletricidade e Magnetismo', 'Termologia', 'Óptica', 'Ondulatória', 'Física Moderna'].map((theme) => {
                  const isActive = selectedTheme === theme;
                  return (
                    <button
                      key={theme}
                      onClick={() => {
                        setSelectedTheme(theme);
                        const matches = questions.filter(q => (theme === 'Todos' || q.tema === theme) && (filterVisual === 'all' || (filterVisual === 'table' ? !!q.tabela : !!q.figura)));
                        if (matches.length > 0 && !matches.some(q => q.id === activeQuestionId)) {
                          setActiveQuestionId(matches[0].id);
                        }
                      }}
                      className={`px-2.5 py-2 text-[11px] font-semibold rounded-lg text-left transition-all ${
                        isActive 
                          ? 'bg-indigo-600 text-white shadow-sm' 
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {theme === 'Todos' ? '📂 Todas as Matérias' : theme}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Filter: Presence of Tables or Images/Graphs */}
            <div className="pt-2 border-t border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase block mb-1.5">Elementos Especiais</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFilterVisual('all')}
                  className={`flex-1 py-1.5 px-2 text-[10px] font-semibold rounded-md transition-all ${
                    filterVisual === 'all'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Todas
                </button>
                <button
                  onClick={() => setFilterVisual('table')}
                  className={`flex-1 py-1.5 px-2 text-[10px] font-semibold rounded-md inline-flex items-center justify-center gap-1 transition-all ${
                    filterVisual === 'table'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/60'
                  }`}
                >
                  <TableIcon size={11} />
                  <span>Tabelas</span>
                </button>
                <button
                  onClick={() => setFilterVisual('figure')}
                  className={`flex-1 py-1.5 px-2 text-[10px] font-semibold rounded-md inline-flex items-center justify-center gap-1 transition-all ${
                    filterVisual === 'figure'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/60'
                  }`}
                >
                  <LineChart size={11} />
                  <span>Gráficos/Imagens</span>
                </button>
              </div>
            </div>
          </div>

          {/* Question List matching selected filter */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col max-h-[500px]">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 tracking-wider">QUESTÕES DE FÍSICA ({filteredQuestions.length})</span>
              {questions.length > 0 && (
                <button
                  onClick={() => setShowLatexModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                  title="Exportar para LaTeX (.tex)"
                >
                  <FileCode size={13} />
                  <span>Exportar .tex</span>
                </button>
              )}
            </div>
            
            <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
              {filteredQuestions.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <HelpCircle className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                  <p className="text-xs">Nenhuma questão encontrada para este filtro.</p>
                </div>
              ) : (
                filteredQuestions.map((q) => {
                  const isActive = q.id === activeQuestionId;
                  const ThemeIcon = themeMeta[q.tema]?.icon || HelpCircle;
                  const themeColor = themeMeta[q.tema]?.color || 'text-slate-500';
                  
                  return (
                    <button
                      key={q.id}
                      onClick={() => setActiveQuestionId(q.id)}
                      className={`w-full text-left p-3.5 transition-colors block ${
                        isActive 
                          ? 'bg-indigo-50/50 border-l-4 border-indigo-600' 
                          : 'hover:bg-slate-50 border-l-4 border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-800">{q.numero}</span>
                        {/* Dynamic category icon & text using custom separator */}
                        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500">
                          <ThemeIcon size={12} className={themeColor} />
                          <span>{q.tema}</span>
                        </div>
                      </div>
                      <h3 className="text-xs font-semibold text-slate-900 line-clamp-2 leading-relaxed mb-1.5">
                        {q.enunciado}
                      </h3>

                      {/* Visual badges for identified Tables and Figures */}
                      {(q.tabela || q.figura) && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          {q.tabela && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-semibold text-amber-800 bg-amber-100/70 border border-amber-300/80 px-1.5 py-0.5 rounded">
                              <TableIcon size={9} />
                              Tabela
                            </span>
                          )}
                          {q.figura && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-semibold text-indigo-800 bg-indigo-100/70 border border-indigo-300/80 px-1.5 py-0.5 rounded">
                              {getFiguraIcon(q.figura.tipo)}
                              {q.figura.tipo}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Quiet metadata line */}
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                        <span>{q.subtema}</span>
                        <span>·</span>
                        <span>Gabarito: {q.gabarito}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          

        </section>

        {/* RIGHT PANEL: Question Content & Answering Hub (65% width / col-span-8) */}
        <section className="lg:col-span-8 space-y-6">
          {!activeQuestion ? (
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-8 text-center space-y-6 flex flex-col items-center justify-center min-h-[400px]">
              <div className="h-16 w-16 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                <Info size={32} />
              </div>
              <div className="max-w-md space-y-2">
                <h3 className="text-lg font-bold text-slate-900">Nenhuma Questão Carregada</h3>
              </div>
              <button
                onClick={() => setShowClassifyModal(true)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-md"
              >
                <Sparkles size={14} />
                Analisar Primeira Prova
              </button>
            </div>
          ) : (
            /* ZONE B: Question Text, Options & Game Play */
            <div id="resolucoes" className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 md:p-6 space-y-6">
            
            {/* Question Heading */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                <span>{activeQuestion.numero}</span>
                <span>·</span>
                <span>Subtema: {activeQuestion.subtema}</span>
                <span>·</span>
                <span className="text-indigo-600 font-semibold">{activeQuestion.tema}</span>
              </div>
              <h3 className="text-base font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                {activeQuestion.enunciado}
              </h3>
            </div>

            {/* Identified Data Table Card (if present) */}
            {activeQuestion.tabela && (
              <div className="bg-slate-50/80 border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="px-4 py-2.5 bg-slate-100/90 border-b border-slate-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TableIcon className="h-4 w-4 text-amber-700 shrink-0" />
                    <span className="text-xs font-bold text-slate-800">
                      {activeQuestion.tabela.titulo || 'Tabela de Dados da Questão'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-medium text-amber-800 bg-amber-100/70 border border-amber-300 px-2 py-0.5 rounded">
                    Tabela Identificada
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-200/60 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        {(activeQuestion.tabela.cabecalho || []).map((col, idx) => (
                          <th key={idx} className="px-3.5 py-2.5 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 bg-white">
                      {(activeQuestion.tabela.linhas || []).map((row, rowIdx) => (
                        <tr key={rowIdx} className="hover:bg-slate-50/80 transition-colors">
                          {(Array.isArray(row) ? row : [row]).map((cell, cellIdx) => (
                            <td key={cellIdx} className="px-3.5 py-2 text-slate-800 font-mono text-xs">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {activeQuestion.tabela.legenda && (
                  <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500 italic">
                    {activeQuestion.tabela.legenda}
                  </div>
                )}
              </div>
            )}

            {/* Identified Visual Element / Graph / Circuit Card (if present) */}
            {activeQuestion.figura && (
              <div className="bg-gradient-to-br from-indigo-50/40 via-white to-sky-50/30 border border-indigo-200/90 rounded-xl p-4 sm:p-5 space-y-3.5 shadow-xs">
                <div className="flex items-start justify-between gap-3 border-b border-indigo-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                      {getFiguraIcon(activeQuestion.figura.tipo)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded">
                          {activeQuestion.figura.tipo}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          Elemento Visual da Questão
                        </span>
                      </div>
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5">
                        {activeQuestion.figura.titulo || 'Ilustração Original da Prova'}
                      </h4>
                    </div>
                  </div>
                  <span className="hidden sm:inline-flex text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    Identificado no ENEM
                  </span>
                </div>

                {/* Detailed Visual Description */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide block">
                    Descrição Detalhada do Gráfico / Esquema:
                  </span>
                  <p className="text-xs sm:text-sm text-slate-800 leading-relaxed bg-white/90 p-3.5 rounded-lg border border-slate-200/80 whitespace-pre-line shadow-xs">
                    {activeQuestion.figura.descricao}
                  </p>
                </div>

                {/* Extracted Visual Data Points */}
                {activeQuestion.figura.dadosVisuais && activeQuestion.figura.dadosVisuais.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide block">
                      Valores e Grandezas Lidos na Imagem:
                    </span>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {(activeQuestion.figura.dadosVisuais || []).map((dado, i) => (
                        <li key={i} className="text-xs font-mono text-slate-700 bg-white/95 px-3 py-1.5 rounded border border-slate-200/70 flex items-start gap-1.5">
                          <span className="text-indigo-600 font-bold shrink-0">•</span>
                          <span>{dado}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {activeQuestion.figura.legenda && (
                  <div className="text-[10px] text-slate-500 italic pt-1 border-t border-indigo-100/60">
                    {activeQuestion.figura.legenda}
                  </div>
                )}
              </div>
            )}

            {/* Multiple Choice Options List */}
            <div className="space-y-2.5">
              {(activeQuestion.alternativas || []).map((alt) => {
                const isSelected = selectedAnswer === alt.letra;
                const isCorrect = alt.letra === activeQuestion.gabarito;
                
                let optionStyle = "border-slate-200 hover:bg-slate-50 text-slate-800";
                if (isSelected) {
                  optionStyle = "border-indigo-600 bg-indigo-50/50 text-indigo-950 font-medium";
                }
                if (answerEvaluated) {
                  if (isCorrect) {
                    optionStyle = "border-emerald-500 bg-emerald-50/70 text-emerald-950 font-semibold";
                  } else if (isSelected) {
                    optionStyle = "border-rose-400 bg-rose-50/50 text-rose-950";
                  }
                }

                return (
                  <button
                    key={alt.letra}
                    disabled={answerEvaluated}
                    onClick={() => handleAnswerSelect(alt.letra)}
                    className={`w-full text-left p-3.5 border rounded-xl flex items-start gap-3 transition-all ${optionStyle}`}
                  >
                    <span className={`h-6 w-6 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${
                      isSelected 
                        ? "bg-indigo-600 text-white border-indigo-600" 
                        : "bg-slate-100 text-slate-700 border-slate-300"
                    }`}>
                      {alt.letra}
                    </span>
                    <span className="text-xs sm:text-sm pt-0.5 leading-relaxed">{alt.texto}</span>
                  </button>
                );
              })}
            </div>

            {/* Answer Evaluator Trigger Bar */}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-500 font-mono">
                {selectedAnswer ? `Selecionado: Opção (${selectedAnswer})` : 'Escolha uma alternativa para testar seu conhecimento.'}
              </div>
              <div className="flex items-center gap-2">
                {!answerEvaluated ? (
                  <button
                    onClick={evaluateAnswer}
                    disabled={!selectedAnswer}
                    className="px-5 py-2.5 bg-slate-950 text-white rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    Responder e Validar
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedAnswer(null);
                      setAnswerEvaluated(false);
                      setShowResolution(false);
                    }}
                    className="px-4 py-2.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all"
                  >
                    Tentar Novamente
                  </button>
                )}
              </div>
            </div>

            {/* Answer Results Callout Banner (No Hue-Only State Signaling!) */}
            {answerEvaluated && (
              <div className={`p-4 rounded-xl border flex items-start gap-3 ${
                selectedAnswer === activeQuestion.gabarito 
                  ? "bg-emerald-50 border-emerald-200 text-emerald-950" 
                  : "bg-rose-50 border-rose-200 text-rose-950"
              }`}>
                {selectedAnswer === activeQuestion.gabarito ? (
                  <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1.5 flex-1">
                  <span className="text-xs font-bold uppercase tracking-wider block">
                    {selectedAnswer === activeQuestion.gabarito ? "● RESPOSTA CORRETA!" : "▲ RESPOSTA INCORRETA"}
                  </span>
                  <p className="text-xs leading-relaxed">
                    {selectedAnswer === activeQuestion.gabarito 
                      ? "Parabéns! Você identificou as relações físicas corretas exigidas nesta questão do ENEM."
                      : `A opção selecionada foi a (${selectedAnswer}), mas o gabarito oficial é a (${activeQuestion.gabarito}). Explore a resolução didática abaixo para dominar o conceito.`
                    }
                  </p>
                </div>
              </div>
            )}

            {/* ZONE C: Pedagógica Detailed Step-by-Step Resolution */}
            {showResolution && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 md:p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-200/60 pb-2.5">
                  <BookOpen className="h-5 w-5 text-indigo-600" />
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">RESOLUÇÃO DIDÁTICA DO PROFESSOR</h4>
                </div>

                {/* Main formulas used block */}
                {activeQuestion.formulas && activeQuestion.formulas.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs text-slate-500 font-semibold uppercase block">Fórmulas e Leis Envolvidas:</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {(activeQuestion.formulas || []).map((form, i) => (
                        <div key={i} className="bg-white border border-slate-200 p-2.5 rounded-lg flex flex-col">
                          <span className="text-[10px] text-slate-500 font-semibold">{form.nome}</span>
                          <span className="text-xs font-mono font-bold text-indigo-600 mt-1 italic">{form.formula}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step-by-Step explanation text */}
                <div className="space-y-2">
                  <span className="text-xs text-slate-500 font-semibold uppercase block">Resolução Passo a Passo:</span>
                  <div className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-line bg-white p-3.5 border border-slate-200 rounded-lg">
                    {activeQuestion.resolucao}
                  </div>
                </div>
              </div>
            )}

          </div>
          )}

        </section>

      </main>

      {/* CLASSIFY NEW EXAM MODAL / HUB OVERLAY */}
      {showClassifyModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold">Carregar Prova do ENEM (PDF)</h3>
              </div>
              <button 
                onClick={() => {
                  setShowClassifyModal(false);
                  setErrorMessage(null);
                  setPdfFile(null);
                  setPdfFileName(null);
                }}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <XCircle size={20} />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleClassifySubmit} className="p-6 flex-1 overflow-y-auto space-y-5">
              
              {/* PDF FILE UPLOADER SECTION */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 tracking-wide uppercase block">Arquivo PDF da Prova (2º Dia)</label>
                <div className={`border-2 border-dashed rounded-xl p-6 transition-colors flex flex-col items-center justify-center text-center relative cursor-pointer ${pdfFileName ? 'border-emerald-400 bg-emerald-50/40' : 'border-slate-300 hover:border-indigo-500 bg-slate-50'}`}>
                  <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  />
                  <FileText className={`h-10 w-10 mb-2 ${pdfFileName ? 'text-emerald-600' : 'text-indigo-500'}`} />
                  {pdfFileName ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-emerald-700">✓ PDF carregado com sucesso!</p>
                      <p className="text-xs font-mono text-slate-700 bg-white px-3 py-1 rounded-md border border-emerald-200 inline-block shadow-xs">{pdfFileName}</p>
                      <p className="text-[10px] text-slate-500 mt-1">Clique para substituir o arquivo se necessário.</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Clique ou arraste o arquivo PDF da prova</p>
                      <p className="text-[10px] text-slate-500 mt-1">A IA identificará o ano, tabelas de dados, gráficos cartesianos e esquemas de circuitos automaticamente.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* SPECIFIC QUESTIONS INPUT (MANDATORY: 91 TO 135 WITH SEPARATORS: SPACE, COMMA, SEMICOLON) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 tracking-wide uppercase flex items-center gap-1.5">
                    <span>Número das Questões</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800">Obrigatório</span>
                  </label>
                  <span className="text-[11px] text-slate-500 font-mono">Valores de 91 a 135</span>
                </div>

                <input
                  type="text"
                  required
                  value={customExamText}
                  onChange={(e) => {
                    setCustomExamText(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Ex: 94, 95; 102 108 115 ou 91 a 135"
                  className="w-full text-xs font-mono p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 text-slate-900 placeholder:text-slate-400 shadow-xs"
                />

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <p>
                    Separadores aceitos: <strong>espaço</strong>, <strong>vírgula (,)</strong> ou <strong>ponto e vírgula (;)</strong>.
                  </p>
                  {customExamText.trim() && (() => {
                    const check = parseAndValidateQuestionNumbers(customExamText);
                    if (check.valid) {
                      return (
                        <span className="text-emerald-700 font-semibold">
                          ✓ {check.numbers.length} {check.numbers.length === 1 ? 'questão' : 'questões'}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-950 text-xs rounded-lg flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{errorMessage}</p>
                </div>
              )}

              {/* Actions footer inside modal */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowClassifyModal(false);
                    setErrorMessage(null);
                    setPdfFile(null);
                    setPdfFileName(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isClassifying || !pdfFile}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  {isClassifying ? (
                    <>
                      <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Extraindo Questões do PDF...
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      Extrair Questões do PDF
                    </>
                  )}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      

      {/* LATEX EXPORT MODAL */}
      <LatexExportModal
        isOpen={showLatexModal}
        onClose={() => setShowLatexModal(false)}
        questions={questions}
      />

    </div>
  );
}
