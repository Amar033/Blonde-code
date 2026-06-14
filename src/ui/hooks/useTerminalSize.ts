import { useState, useEffect } from 'react';

export function useTerminalSize() {
  const [size, setSize] = useState({
    columns: process.stdout.columns ?? 80,
    rows:    process.stdout.rows    ?? 24,
  });

  useEffect(() => {
    const update = () => setSize({
      columns: process.stdout.columns ?? 80,
      rows:    process.stdout.rows    ?? 24,
    });
    process.stdout.on('resize', update);
    return () => void process.stdout.off('resize', update);
  }, []);

  return size;
}
