/**
 *Agent Design System for blonde, took reference from claude
 *
 * */ 

export const colors={
  brand:'#FF1493',

  // status colours
  idle:"#6B7280",
  thinking:"#F59E0B",
  working:"#3B82F6",
  success:"#10B981",
  error:"#EF4444",
  warning:"#F59E0B",

  // ui elements
  text: '#F9FAFB',
  textDim: '#9CA3AF',
  textMuted: '#6B7280',

  bg: '#111827',
  bgLight: '#1F2937',
  bgHighlight: '#374151',

  border: '#374151',
  borderActive: '#3B82F6',

  keyword: '#C084FC',
  string: '#34D399',
  number: '#60A5FA',
  comment: '#6B7280',
};

export const icons = {
  // Status
  idle: '○',
  thinking: '◐',
  working: '●',
  success: '✓',
  error: '✗',
  warning: '⚠',
  
  // Operations
  file: '📄',
  folder: '📁',
  tool: '🔧',
  search: '🔍',
  
  // Agent states
  planning: '🧠',
  acting: '⚡',
  observing: '👁',
  completed: '✅',
  
  // UI
  arrow: '→',
  bullet: '•',
  chevron: '›',
};

export const borders = {
  none: undefined,
  subtle: {
    type: 'single' as const,
    borderColor: colors.border,
  },
  active: {
    type: 'round' as const,
    borderColor: colors.borderActive,
  },
  success: {
    type: 'round' as const,
    borderColor: colors.success,
  },
  error: {
    type: 'round' as const,
    borderColor: colors.error,
  },
};

export const spacing = {
  xs: 0,
  sm: 1,
  md: 2,
  lg: 3,
};
