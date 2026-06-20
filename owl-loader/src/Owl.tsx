import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';

// Simple SVG owl — body, head, eyes, beak, two flapping wings
// Designed for 80×80 viewport, transparent background
export const Owl: React.FC = () => {
  const frame = useCurrentFrame();
  const totalFrames = 48; // 24fps × 2 sec loop

  // Wing flap: full cycle in 12 frames (fast)
  const wingCycle = frame % 12;
  const wingAngle = interpolate(
    wingCycle,
    [0, 3, 6, 9, 12],
    [0, -28, 0, 28, 0],
    { easing: Easing.inOut(Easing.sin), extrapolateRight: 'clamp' }
  );

  // Gentle vertical bob: full bob every 24 frames
  const bobY = interpolate(
    frame % 24,
    [0, 6, 12, 18, 24],
    [0, -3, 0, 3, 0],
    { easing: Easing.inOut(Easing.sin), extrapolateRight: 'clamp' }
  );

  // Eye blink every ~36 frames
  const blinkProgress = interpolate(
    frame % 36,
    [0, 33, 34, 35, 36],
    [1, 1, 0.1, 1, 1],
    { extrapolateRight: 'clamp' }
  );

  const cx = 40;
  const cy = 44 + bobY;

  return (
    <svg
      width={80}
      height={80}
      viewBox="0 0 80 80"
      style={{ background: 'transparent' }}
    >
      {/* ── Left wing ── */}
      <g
        transform={`rotate(${-wingAngle}, ${cx - 10}, ${cy + 2})`}
        style={{ transformOrigin: `${cx - 10}px ${cy + 2}px` }}
      >
        <ellipse
          cx={cx - 18}
          cy={cy + 4}
          rx={14}
          ry={8}
          fill="#5a3e14"
          transform={`rotate(-20, ${cx - 18}, ${cy + 4})`}
        />
        <ellipse
          cx={cx - 22}
          cy={cy + 8}
          rx={10}
          ry={5}
          fill="#3e2a0a"
          transform={`rotate(-25, ${cx - 22}, ${cy + 8})`}
        />
      </g>

      {/* ── Right wing ── */}
      <g
        transform={`rotate(${wingAngle}, ${cx + 10}, ${cy + 2})`}
        style={{ transformOrigin: `${cx + 10}px ${cy + 2}px` }}
      >
        <ellipse
          cx={cx + 18}
          cy={cy + 4}
          rx={14}
          ry={8}
          fill="#5a3e14"
          transform={`rotate(20, ${cx + 18}, ${cy + 4})`}
        />
        <ellipse
          cx={cx + 22}
          cy={cy + 8}
          rx={10}
          ry={5}
          fill="#3e2a0a"
          transform={`rotate(25, ${cx + 22}, ${cy + 8})`}
        />
      </g>

      {/* ── Body ── */}
      <ellipse cx={cx} cy={cy + 8} rx={14} ry={18} fill="#7a5820" />
      {/* Chest feather pattern */}
      <ellipse cx={cx} cy={cy + 10} rx={9} ry={12} fill="#a07830" opacity={0.6} />

      {/* ── Head ── */}
      <circle cx={cx} cy={cy - 10} r={14} fill="#8b6420" />

      {/* ── Ear tufts ── */}
      <ellipse cx={cx - 8} cy={cy - 23} rx={4} ry={7} fill="#7a5820"
        transform={`rotate(-10, ${cx - 8}, ${cy - 23})`} />
      <ellipse cx={cx + 8} cy={cy - 23} rx={4} ry={7} fill="#7a5820"
        transform={`rotate(10, ${cx + 8}, ${cy - 23})`} />

      {/* ── Facial disk ── */}
      <ellipse cx={cx} cy={cy - 9} rx={10} ry={9} fill="#c8a050" opacity={0.5} />

      {/* ── Eyes ── */}
      {/* Left eye */}
      <circle cx={cx - 5} cy={cy - 11} r={4} fill="#ffdd44" />
      <circle cx={cx - 5} cy={cy - 11} r={4 * blinkProgress} fill="#ffdd44" />
      <circle cx={cx - 5} cy={cy - 11} r={2.5 * blinkProgress} fill="#1a1a1a" />
      <circle cx={cx - 4.5} cy={cy - 11.5} r={0.7} fill="white" opacity={0.9} />

      {/* Right eye */}
      <circle cx={cx + 5} cy={cy - 11} r={4} fill="#ffdd44" />
      <circle cx={cx + 5} cy={cy - 11} r={4 * blinkProgress} fill="#ffdd44" />
      <circle cx={cx + 5} cy={cy - 11} r={2.5 * blinkProgress} fill="#1a1a1a" />
      <circle cx={cx + 5.5} cy={cy - 11.5} r={0.7} fill="white" opacity={0.9} />

      {/* ── Beak ── */}
      <polygon
        points={`${cx},${cy - 6} ${cx - 3},${cy - 2} ${cx + 3},${cy - 2}`}
        fill="#e08820"
      />

      {/* ── Talons ── */}
      <line x1={cx - 7} y1={cy + 25} x2={cx - 12} y2={cy + 30} stroke="#c07010" strokeWidth={2} strokeLinecap="round" />
      <line x1={cx - 7} y1={cy + 25} x2={cx - 7}  y2={cy + 31} stroke="#c07010" strokeWidth={2} strokeLinecap="round" />
      <line x1={cx - 7} y1={cy + 25} x2={cx - 2}  y2={cy + 30} stroke="#c07010" strokeWidth={2} strokeLinecap="round" />
      <line x1={cx + 7} y1={cy + 25} x2={cx + 2}  y2={cy + 30} stroke="#c07010" strokeWidth={2} strokeLinecap="round" />
      <line x1={cx + 7} y1={cy + 25} x2={cx + 7}  y2={cy + 31} stroke="#c07010" strokeWidth={2} strokeLinecap="round" />
      <line x1={cx + 7} y1={cy + 25} x2={cx + 12} y2={cy + 30} stroke="#c07010" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
};
