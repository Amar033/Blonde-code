import React, { useState, useEffect } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

interface BrailleSpinnerProps {
  color?: string;
}

export const BrailleSpinner: React.FC<BrailleSpinnerProps> = ({ color }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);

  return <text fg={color}>{FRAMES[frame]}</text>;
};
