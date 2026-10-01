/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Alternativa {
  letra: string;
  texto: string;
}

export interface QuestaoFísica {
  id: string;
  numero: string;
  enunciado: string;
  tema: 'Mecânica' | 'Eletricidade e Magnetismo' | 'Termologia' | 'Óptica' | 'Ondulatória' | 'Física Moderna' | null;
  subtema: string;
  alternativas: Alternativa[];
  temFigura: boolean;
  figuras?: {
    tipo: string;
    bbox: { x: number; y: number; width: number; height: number };
  }[];
  figuraBase64?: string; // Crop figure as single-page vector PDF Base64 string
  figura?: any; // For backward compatibility if any
}
