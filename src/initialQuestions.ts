/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { QuestaoFísica } from './types';

export const INITIAL_QUESTIONS: QuestaoFísica[] = [
  {
    id: 'demo-1',
    numero: 'Questão 95 (ENEM 2024)',
    tema: 'Eletricidade e Magnetismo',
    subtema: 'Eletrodinâmica e Consumo de Energia',
    enunciado: 'Uma família deseja reduzir os gastos com energia elétrica em sua residência durante o mês de 30 dias. Para isso, o responsável realizou um levantamento dos aparelhos elétricos de maior potência instalados na casa, anotando o tempo médio em que cada um permanece ligado diariamente, conforme apresentado na tabela a seguir.\n\nSabendo que a concessionária de energia cobra R$ 0,80 por cada quilowatt-hora (kWh) consumido, qual é o custo mensal aproximado gerado apenas pelo funcionamento do chuveiro elétrico dessa residência?',
    tabela: {
      titulo: 'Tabela de Potência e Tempo de Uso Diário dos Eletrodomésticos',
      cabecalho: ['Aparelho', 'Potência Nominal (W)', 'Uso Diário (h)'],
      linhas: [
        ['Chuveiro elétrico', '5 500', '0,5'],
        ['Geladeira Frost Free', '250', '24'],
        ['Televisor LED', '120', '5'],
        ['Conjunto de Lâmpadas LED', '60', '6']
      ],
      legenda: 'Fonte: Dados de medição e especificações do fabricante.'
    },
    alternativas: [
      { letra: 'A', texto: 'R$ 22,00' },
      { letra: 'B', texto: 'R$ 66,00' },
      { letra: 'C', texto: 'R$ 82,50' },
      { letra: 'D', texto: 'R$ 132,00' },
      { letra: 'E', texto: 'R$ 165,00' }
    ],
    gabarito: 'B',
    resolucao: '1. Identificação dos dados na tabela:\n- Potência do chuveiro: P = 5 500 W = 5,5 kW.\n- Tempo diário de uso: Δt_dia = 0,5 h.\n- Número de dias no mês: 30 dias.\n\n2. Cálculo da energia elétrica consumida no mês:\nE = P · Δt_total\nΔt_total = 0,5 h/dia · 30 dias = 15 h\nE = 5,5 kW · 15 h = 82,5 kWh\n\n3. Cálculo do custo financeiro:\nCusto = Energia (kWh) · Tarifa (R$/kWh)\nCusto = 82,5 · 0,80 = R$ 66,00.\n\nPortanto, a alternativa correta é a B.',
    formulas: [
      { nome: 'Energia Elétrica', formula: 'E = P · \\Delta t' },
      { nome: 'Custo da Energia', formula: '\\text{Custo} = E \\cdot \\text{Tarifa}' }
    ]
  },
  {
    id: 'demo-2',
    numero: 'Questão 102 (ENEM 2024)',
    tema: 'Mecânica',
    subtema: 'Trabalho e Energia',
    enunciado: 'Um carrinho experimental de massa 4,0 kg desloca-se em linha reta sobre uma superfície horizontal lisa e sem atrito. Uma força resultante horizontal de direção constante passa a atuar sobre o carrinho, cuja intensidade varia com a posição conforme ilustrado no gráfico abaixo.\n\nConsiderando que o carrinho partiu do repouso na posição d = 0 m, determine a energia cinética adquirida pelo móvel ao atingir a posição d = 8,0 m.',
    figura: {
      tipo: 'Gráfico',
      titulo: 'Gráfico da Força Resultante F (N) em função do Deslocamento d (m)',
      descricao: 'Gráfico cartesiano plano no qual o eixo vertical (ordenadas) representa a força resultante F em newtons (N), variando de 0 a 60 N, e o eixo horizontal (abscissas) representa o deslocamento d em metros (m), variando de 0 a 8 m. O gráfico é composto por duas partes contínuas: de d = 0 até d = 4 m, a força cresce linearmente de 0 N a 60 N (formando uma região triangular); de d = 4 m até d = 8 m, a força mantém-se constante no valor de 60 N (formando uma região retangular).',
      dadosVisuais: [
        'Eixo Vertical: Força F (N) de 0 a 60 N',
        'Eixo Horizontal: Deslocamento d (m) de 0 a 8 m',
        'Trecho 1 (0 a 4 m): Reta ligando a origem (0, 0) ao ponto (4, 60)',
        'Trecho 2 (4 a 8 m): Reta horizontal ligando (4, 60) ao ponto (8, 60)',
        'Área sob a curva é numericamente igual ao trabalho total realizado'
      ],
      legenda: 'Gráfico adaptado da prova de Ciências da Natureza do ENEM.'
    },
    alternativas: [
      { letra: 'A', texto: '120 J' },
      { letra: 'B', texto: '240 J' },
      { letra: 'C', texto: '360 J' },
      { letra: 'D', texto: '480 J' },
      { letra: 'E', texto: '540 J' }
    ],
    gabarito: 'C',
    resolucao: '1. Propriedade do gráfico Força versus Deslocamento:\nEm um gráfico F × d, o trabalho realizado pela força resultante é numericamente igual à área sob a curva (área de um trapézio ou soma de triângulo com retângulo).\n\n2. Cálculo da área:\n- Área do triângulo (de 0 a 4 m):\nA_1 = (base · altura) / 2 = (4 · 60) / 2 = 120 J\n- Área do retângulo (de 4 a 8 m):\nA_2 = base · altura = (8 - 4) · 60 = 4 · 60 = 240 J\n\nTrabalho total: W = A_1 + A_2 = 120 + 240 = 360 J.\n\n3. Teorema da Energia Cinética (TEC):\nW_total = \\Delta E_c = E_c_final - E_c_inicial\nComo o carrinho parte do repouso, E_c_inicial = 0.\nPortanto, E_c_final = 360 J.\n\nA alternativa correta é a letra C.',
    formulas: [
      { nome: 'Trabalho Gráfico F × d', formula: 'W \\stackrel{N}{=} \\text{Área}' },
      { nome: 'Teorema da Energia Cinética', formula: 'W_{\\text{total}} = \\Delta E_c = E_{c,f} - E_{c,i}' }
    ]
  },
  {
    id: 'demo-3',
    numero: 'Questão 115 (ENEM 2023)',
    tema: 'Eletricidade e Magnetismo',
    subtema: 'Circuitos Elétricos e Associação de Resistores',
    enunciado: 'Um professor monta um circuito elétrico para demonstrar aos estudantes como a intensidade luminosa de lâmpadas incandescentes varia conforme a configuração do circuito. O circuito é composto por um gerador ideal de força eletromotriz constante V, três lâmpadas idênticas L1, L2 e L3 (todas de resistência elétrica R), e uma chave interruptora S inicialmente aberta, conforme ilustrado no esquema a seguir.\n\nAo fechar a chave interruptora S, o que acontece com o brilho da lâmpada L1 e com a corrente total fornecida pelo gerador?',
    figura: {
      tipo: 'Circuito elétrico',
      titulo: 'Esquema do Circuito com Gerador V, Chave S e Lâmpadas L1, L2 e L3',
      descricao: 'O esquema elétrico mostra uma fonte de tensão constante conectada em série com a lâmpada L1. Em seguida, o circuito se divide em dois ramos em paralelo: um ramo contém a lâmpada L2 e o outro ramo contém a chave S em série com a lâmpada L3. Inicialmente, a chave S está aberta (ramo de L3 desativado). Quando a chave S é fechada, a lâmpada L3 passa a ficar em paralelo com a lâmpada L2.',
      dadosVisuais: [
        'Fonte ideal de tensão V',
        'Lâmpada L1 em série com o nó do paralelo',
        'Ramo em paralelo com L2 e (S + L3)',
        'Chave interruptora S no ramo de L3',
        'Todas as lâmpadas possuem resistência R idêntica'
      ],
      legenda: 'Circuito de demonstração didática do ENEM.'
    },
    alternativas: [
      { letra: 'A', texto: 'O brilho de L1 diminui e a corrente total do gerador diminui.' },
      { letra: 'B', texto: 'O brilho de L1 permanece inalterado e a corrente total não se altera.' },
      { letra: 'C', texto: 'O brilho de L1 aumenta e a corrente total fornecida pelo gerador aumenta.' },
      { letra: 'D', texto: 'O brilho de L1 aumenta e a corrente total fornecida pelo gerador diminui.' },
      { letra: 'E', texto: 'O brilho de L1 diminui e a corrente total fornecida pelo gerador aumenta.' }
    ],
    gabarito: 'C',
    resolucao: '1. Situação inicial (Chave S aberta):\n- A corrente não passa pelo ramo de L3.\n- O circuito tem apenas L1 e L2 em série: R_eq,1 = R + R = 2R.\n- Corrente inicial: I_1 = V / (2R).\n\n2. Situação final (Chave S fechada):\n- As lâmpadas L2 e L3 ficam em paralelo: R_p = R / 2.\n- A resistência equivalente total do circuito torna-se: R_eq,2 = R + R/2 = 1,5R.\n\n3. Análise da corrente total e da lâmpada L1:\n- Como a resistência equivalente diminuiu de 2R para 1,5R, a corrente total fornecida pelo gerador aumenta: I_2 = V / (1,5R) = 2V / (3R) > I_1.\n- Como toda a corrente total I atravessa a lâmpada L1 (que está no ramo principal), a potência dissipada por L1 (P = R · I²) aumenta consideravelmente, aumentando seu brilho.\n\nPortanto, o brilho de L1 aumenta e a corrente total fornecida pelo gerador aumenta. Alternativa C.',
    formulas: [
      { nome: 'Resistores em Paralelo', formula: 'R_p = \\frac{R}{2}' },
      { nome: 'Primeira Lei de Ohm', formula: 'I = \\frac{V}{R_{\\text{eq}}}' },
      { nome: 'Potência Elétrica (Brilho)', formula: 'P = R \\cdot I^2' }
    ]
  },
  {
    id: 'demo-4',
    numero: 'Questão 122 (ENEM 2023)',
    tema: 'Termologia',
    subtema: 'Calorimetria e Propagação de Calor',
    enunciado: 'Para projetar um recipiente térmico que mantenha líquidos aquecidos pelo maior período de tempo possível, um engenheiro testou cinco materiais isolantes de mesma espessura e mesma área superficial sob uma diferença de temperatura constante. A condutividade térmica (k) de cada material avaliado foi compilada na tabela a seguir.\n\nQual dos materiais listados proporcionará o melhor isolamento térmico (menor taxa de transferência de calor por condução) para a fabricação do recipiente?',
    tabela: {
      titulo: 'Tabela de Condutividade Térmica dos Materiais Testados',
      cabecalho: ['Material', 'Condutividade Térmica k (W / m · K)', 'Custo Relativo'],
      linhas: [
        ['Poliuretano expandido (Material 1)', '0,022', 'Médio'],
        ['Lã de vidro (Material 2)', '0,040', 'Baixo'],
        ['Cortiça natural (Material 3)', '0,045', 'Baixo'],
        ['Borracha compacta (Material 4)', '0,150', 'Médio'],
        ['Vidro comum (Material 5)', '0,800', 'Alto']
      ],
      legenda: 'Fonte: Tabela de propriedades térmicas padronizadas (NBR/ISO).'
    },
    alternativas: [
      { letra: 'A', texto: 'Material 1' },
      { letra: 'B', texto: 'Material 2' },
      { letra: 'C', texto: 'Material 3' },
      { letra: 'D', texto: 'Material 4' },
      { letra: 'E', texto: 'Material 5' }
    ],
    gabarito: 'A',
    resolucao: '1. Pela Lei de Fourier para condução térmica:\nΦ = (k · A · ΔT) / L\nonde Φ é o fluxo de calor, k é a condutividade térmica, A é a área superficial, ΔT é a diferença de temperatura e L é a espessura da parede do recipiente.\n\n2. Para que o recipiente mantenha o líquido aquecido pelo maior tempo possível, a perda de calor (fluxo de calor Φ) deve ser a MENOR possível.\n\n3. Como a área A, a espessura L e a diferença de temperatura ΔT são iguais para todos os materiais, o fluxo Φ é diretamente proporcional à condutividade térmica k.\n\n4. O material com a menor condutividade térmica k é o Poliuretano expandido (Material 1, com k = 0,022 W/m·K).\n\nPortanto, o melhor isolante térmico é o Material 1 (Alternativa A).',
    formulas: [
      { nome: 'Lei de Fourier', formula: '\\Phi = \\frac{k \\cdot A \\cdot \\Delta T}{L}' }
    ]
  }
];
