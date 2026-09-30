/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  FileCode, 
  Download, 
  Copy, 
  Check, 
  FolderArchive, 
  XCircle, 
  FileText,
  SlidersHorizontal,
  Info
} from 'lucide-react';
import { QuestaoFísica } from '../types';
import { 
  generateAllThemesFiles, 
  downloadLatexFile, 
  downloadAllThemesZip,
  LatexExportOptions 
} from '../latexExporter';

interface LatexExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  questions: QuestaoFísica[];
}

export const LatexExportModal: React.FC<LatexExportModalProps> = ({
  isOpen,
  onClose,
  questions
}) => {
  const [includeComments, setIncludeComments] = useState<boolean>(true);
  const [includeResolucao, setIncludeResolucao] = useState<boolean>(false);
  const [selectedFilename, setSelectedFilename] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);

  const exportOptions: LatexExportOptions = useMemo(() => ({
    includeComments,
    includeResolucao
  }), [includeComments, includeResolucao]);

  // Agrupa os arquivos por tema dinamicamente
  const themeFiles = useMemo(() => {
    return generateAllThemesFiles(questions, exportOptions);
  }, [questions, exportOptions]);

  const fileList = useMemo(() => Object.values(themeFiles), [themeFiles]);

  // Define a aba ativa padrão caso nenhuma esteja selecionada
  React.useEffect(() => {
    if (fileList.length > 0 && (!selectedFilename || !themeFiles[selectedFilename])) {
      setSelectedFilename(fileList[0].filename);
    }
  }, [fileList, selectedFilename, themeFiles]);

  if (!isOpen) return null;

  const activeFile = selectedFilename ? themeFiles[selectedFilename] : fileList[0];

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar para o clipboard:', err);
    }
  };

  const handleDownloadSingle = () => {
    if (!activeFile) return;
    downloadLatexFile(activeFile.filename, activeFile.content);
  };

  const handleDownloadAllZip = async () => {
    if (fileList.length === 0) return;
    setIsZipping(true);
    try {
      await downloadAllThemesZip(themeFiles, 'enem_fisica_latex_por_tema.zip');
    } catch (err) {
      console.error('Erro ao gerar arquivo ZIP:', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
              <FileCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight">Exportar Questões em LaTeX</h3>
              <p className="text-xs text-slate-300">
                Gera 1 arquivo <code className="text-indigo-300 font-mono">.tex</code> para cada temática no formato <code className="text-amber-300 font-mono">\questao</code> e <code className="text-amber-300 font-mono">\begin&#123;alternativas&#125;</code>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            title="Fechar"
          >
            <XCircle size={22} />
          </button>
        </div>

        {/* Content Body */}
        {questions.length === 0 ? (
          <div className="p-12 text-center space-y-4 flex flex-col items-center justify-center">
            <div className="p-4 bg-slate-100 rounded-full text-slate-400">
              <FileText size={36} />
            </div>
            <div className="space-y-1 max-w-md">
              <h4 className="text-base font-bold text-slate-800">Nenhuma questão carregada</h4>
              <p className="text-xs text-slate-500">
                Você precisa carregar uma prova em PDF do ENEM para que as questões de Física sejam extraídas e fiquem disponíveis para exportação.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
            >
              Voltar ao Início
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            
            {/* Top Bar: Summary + Batch Download Action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-gradient-to-r from-indigo-50 via-slate-50 to-indigo-50/30 rounded-xl border border-indigo-100">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
                  Resumo de Exportação
                </span>
                <p className="text-xs text-slate-600">
                  <strong className="text-indigo-700">{questions.length} questões</strong> distribuídas em <strong className="text-indigo-700">{fileList.length} arquivos temáticos</strong>.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadAllZip}
                  disabled={isZipping || fileList.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <FolderArchive size={15} />
                  {isZipping ? 'Compactando...' : 'Baixar Todos (.ZIP por tema)'}
                </button>
              </div>
            </div>

            {/* Options configuration */}
            <div className="flex flex-wrap items-center gap-6 px-1 text-xs text-slate-700">
              <div className="flex items-center gap-1.5 font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                <SlidersHorizontal size={13} />
                Opções do Código:
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeComments}
                  onChange={(e) => setIncludeComments(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Comentário com número da questão e gabarito (<code className="font-mono text-[10px] text-slate-500">% Questão XX | Gabarito: Y</code>)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeResolucao}
                  onChange={(e) => setIncludeResolucao(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span>Comentário com resolução passo a passo (<code className="font-mono text-[10px] text-slate-500">% [Resolução] ...</code>)</span>
              </label>
            </div>

            {/* Theme Tabs */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wide block">
                Selecione o arquivo temático para visualizar ou baixar:
              </label>
              <div className="flex flex-wrap gap-2">
                {fileList.map((file) => {
                  const isSelected = selectedFilename === file.filename;
                  return (
                    <button
                      key={file.filename}
                      onClick={() => setSelectedFilename(file.filename)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isSelected 
                          ? 'bg-slate-900 text-white shadow-sm ring-2 ring-indigo-500/50' 
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                      }`}
                    >
                      <FileCode size={13} className={isSelected ? 'text-indigo-400' : 'text-slate-500'} />
                      <span>{file.tema}</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {file.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Theme Preview & Action Card */}
            {activeFile && (
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                      📄 {activeFile.filename}
                    </span>
                    <span className="text-xs text-slate-500">
                      ({activeFile.count} {activeFile.count === 1 ? 'questão' : 'questões'})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      {isCopied ? (
                        <>
                          <Check size={14} className="text-emerald-600" />
                          <span className="text-emerald-700 font-bold">Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} />
                          <span>Copiar Código</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleDownloadSingle}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs cursor-pointer"
                    >
                      <Download size={14} />
                      <span>Baixar {activeFile.filename}</span>
                    </button>
                  </div>
                </div>

                {/* LaTeX Code Preview Box */}
                <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-inner">
                  <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                    <span>LaTeX Source Preview</span>
                    <span>UTF-8 · .tex</span>
                  </div>
                  <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-[320px] overflow-y-auto leading-relaxed whitespace-pre select-all selection:bg-indigo-600 selection:text-white">
                    {activeFile.content}
                  </pre>
                </div>
              </div>
            )}

            {/* Helpful Guide Footnote */}
            <div className="flex items-start gap-2 p-3 bg-amber-50/70 border border-amber-200/80 rounded-lg text-amber-900 text-xs">
              <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Compatibilidade com compiladores LaTeX:</strong> O formato gerado utiliza os comandos <code className="bg-amber-100/70 px-1 py-0.5 rounded font-mono font-semibold">\questao</code> e o ambiente <code className="bg-amber-100/70 px-1 py-0.5 rounded font-mono font-semibold">\begin&#123;alternativas&#125; ... \end&#123;alternativas&#125;</code>, compatível com os pacotes habituais de listas de exercícios e vestibulares.
              </p>
            </div>

          </div>
        )}

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  );
};
