/**
 * Renders an image using the Kitty graphics protocol when the terminal
 * supports it (detected via renderer.capabilities.kitty_graphics).
 * Falls back to the passed `fallback` element if unsupported.
 *
 * Position is specified in terminal cells (row/col from top-left of the
 * terminal, 0-indexed). This component renders an invisible placeholder
 * box at the given size and injects Kitty escape data via
 * renderer["lib"].writeOut() on each frame.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useRenderer } from '@opentui/react';

interface KittyImageProps {
  src:      string;          // file path (png/jpg/gif)
  width:    number;          // cell columns
  height:   number;          // cell rows
  col:      number;          // 0-indexed column to place image
  row:      number;          // 0-indexed row to place image
  fallback: React.ReactNode; // shown when kitty not supported
}

let kittyId = 1;

export const KittyImage: React.FC<KittyImageProps> = ({
  src, width, height, col, row, fallback
}) => {
  const renderer = useRenderer();
  const [supported, setSupported] = useState<boolean | null>(null);
  const framesRef   = useRef<Uint8Array[]>([]);
  const delaysRef   = useRef<number[]>([]);
  const frameIdxRef = useRef(0);
  const idRef       = useRef(kittyId++);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check capability and load image
  useEffect(() => {
    const caps = (renderer as any).capabilities;
    if (!caps?.kitty_graphics) {
      setSupported(false);
      return;
    }
    setSupported(true);

    // Load image frames via sharp
    (async () => {
      try {
        const [{ default: sharp }, { default: fs }] = await Promise.all([
          import('sharp' as any),
          import('fs'),
        ]);
        const isGif = src.toLowerCase().endsWith('.gif');
        const meta  = await sharp(src, { animated: false }).metadata();
        const pages = isGif ? (meta.pages ?? 1) : 1;
        const delays: number[] = Array.isArray((meta as any).delay) ? (meta as any).delay : [];

        const frames: Uint8Array[] = [];
        for (let i = 0; i < pages; i++) {
          const buf = await sharp(src, { animated: false, page: i })
            .resize(width * 8, height * 8, { fit: 'fill' })
            .raw()
            .toBuffer();
          frames.push(new Uint8Array(buf));
          delaysRef.current.push(delays[i] ?? 100);
        }
        framesRef.current = frames;
      } catch {
        setSupported(false);
      }
    })();

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src, renderer]);

  // Inject Kitty data each animation frame
  useEffect(() => {
    if (!supported || framesRef.current.length === 0) return;

    const writeFrame = () => {
      const frame = framesRef.current[frameIdxRef.current];
      if (!frame) return;

      // Move cursor to position (1-indexed in terminal)
      const moveCursor = `\x1b[${row + 1};${col + 1}H`;
      // Kitty graphics: transmit raw RGB, display immediately
      const b64 = Buffer.from(frame).toString('base64');
      const chunkSize = 4096;
      let kittyData = '';
      for (let i = 0; i < b64.length; i += chunkSize) {
        const chunk = b64.slice(i, i + chunkSize);
        const isLast = i + chunkSize >= b64.length;
        const isFirst = i === 0;
        if (isFirst) {
          kittyData += `\x1b_Ga=T,f=24,s=${width * 8},v=${height * 8},c=${width},r=${height},i=${idRef.current},m=${isLast ? 0 : 1};${chunk}\x1b\\`;
        } else {
          kittyData += `\x1b_Gm=${isLast ? 0 : 1};${chunk}\x1b\\`;
        }
      }

      try {
        const lib  = (renderer as any).lib;
        const rPtr = (renderer as any).rendererPtr;
        lib?.writeOut?.(rPtr, moveCursor + kittyData);
      } catch {}

      if (framesRef.current.length > 1) {
        const delay = delaysRef.current[frameIdxRef.current] ?? 100;
        frameIdxRef.current = (frameIdxRef.current + 1) % framesRef.current.length;
        timerRef.current = setTimeout(writeFrame, delay);
      }
    };

    // Hook into renderer frame callback
    try {
      (renderer as any).setFrameCallback?.(async () => {
        if (timerRef.current === null && framesRef.current.length > 0) writeFrame();
      });
    } catch {}

    writeFrame();
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      // Delete the image from terminal
      try {
        const lib  = (renderer as any).lib;
        const rPtr = (renderer as any).rendererPtr;
        lib?.writeOut?.(rPtr, `\x1b_Ga=d,i=${idRef.current};\x1b\\`);
      } catch {}
    };
  }, [supported, renderer, col, row, width, height]);

  if (supported === false) return <>{fallback}</>;
  // Invisible placeholder that reserves space
  return <box width={width} height={height} />;
};
