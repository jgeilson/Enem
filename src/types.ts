/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Alternativa {
  letra: string;
  texto: string;
}

export interface Formula {
  nome: string;
  formula: string;
}

export interface TabelaQuestao {
  titulo?: string;
  cabecalho: string[];
  linhas: string[][];
  legenda?: string;
}

export interface FiguraQuestao {
  tipo: 'Gráfico' | 'Circuito elétrico' | 'Esquema mecânico' | 'Diagrama óptico' | 'Ondas/Oscilações' | 'Ilustração experimental' | 'Outro';
  titulo?: string;
  descricao: string;
  dadosVisuais?: string[];
  legenda?: string;
}

export interface QuestaoFísica {
  id: string;
  numero: string;
  enunciado: string;
  tema: 'Mecânica' | 'Eletricidade e Magnetismo' | 'Termologia' | 'Óptica' | 'Ondulatória' | 'Física Moderna';
  subtema: string;
  alternativas: Alternativa[];
  gabarito: string;
  resolucao: string;
  formulas: Formula[];
  tabela?: TabelaQuestao | null;
  figura?: FiguraQuestao | null;
}
