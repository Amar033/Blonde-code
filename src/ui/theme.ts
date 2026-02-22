
export const colors = {
  // State colors
  planning: '#FFD700',      // Gold
  acting: '#00BFFF',        // Deep sky blue
  executing: '#FF1493',     // Deep pink
  observing: '#00CED1',     // Dark turquoise
  completed: '#00FF7F',     // Spring green
  aborted: '#FF6347',       // Tomato
  waiting: '#A9A9A9',       // Dark gray

  // UI colors
  primary: '#FF1493',       // Deep pink (brand)
  secondary: '#00BFFF',     // Blue
  success: '#00FF7F',       // Green
  error: '#FF6347',         // Red
  warning: '#FFD700',       // Yellow
  info: '#00CED1',          // Cyan
  
  // Text colors
  text: '#FFFFFF',          // White
  textDim: '#808080',       // Gray
  textBold: '#FFFFFF',      // White
  
  // Border colors
  border: '#00BFFF',        // Blue
  borderDim: '#404040',     // Dark gray
};

export const symbols = {
  // Progress indicators
  done: '✓',
  current: '→',
  pending: '○',
  error: '✗',
  
  // Status icons
  thinking: '🧠',
  tool: '🔧',
  success: '✅',
  failure: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  
  // Agent icons
  agent: '🎯',
  plan: '📋',
  history: '📊',
  chat: '💬',
};

export const borders = {
  main: {
    type: 'double' as const,
    borderColor: colors.border,
  },
  section: {
    type: 'round' as const,
    borderColor: colors.borderDim,
  },
  highlight: {
    type: 'bold' as const,
    borderColor: colors.primary,
  },
};
