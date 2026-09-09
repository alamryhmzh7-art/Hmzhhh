import React from 'react';
import { motion } from 'motion/react';

interface GaugeProps {
  label: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
  color?: string;
  textColor?: string;
  size?: number;
  strokeWidth?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  icon?: React.ReactNode;
  isNotSupported?: boolean;
}

export const Gauge: React.FC<GaugeProps> = ({
  label,
  value,
  min,
  max,
  unit,
  color = 'stroke-cyan-500',
  textColor = 'text-cyan-400',
  size = 180,
  strokeWidth = 12,
  warningThreshold,
  criticalThreshold,
  icon,
  isNotSupported = false
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  
  const numericVal = typeof value === 'number' && !isNaN(value) ? value : min;
  const clampedVal = Math.max(min, Math.min(max, numericVal));
  const percentage = (clampedVal - min) / (max - min);
  const strokeDashoffset = circumference - percentage * circumference;

  let activeColor = color;
  let activeTextColor = textColor;

  if (criticalThreshold !== undefined && numericVal >= criticalThreshold) {
    activeColor = 'stroke-red-500';
    activeTextColor = 'text-red-500';
  } else if (warningThreshold !== undefined && numericVal >= warningThreshold) {
    activeColor = 'stroke-amber-500';
    activeTextColor = 'text-amber-500';
  }

  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-slate-700 transition-all">
      {icon && (
        <div className="absolute top-4 left-4 text-slate-400 group-hover:text-white transition-colors">
          {icon}
        </div>
      )}
      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 font-mono">
        {label}
      </span>

      <div className="relative flex items-center justify-center my-3" style={{ width: size, height: size }}>
        <svg className="w-full h-full transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="stroke-slate-800"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className={`${activeColor}`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        <div className="absolute flex flex-col items-center justify-center text-center px-2">
          {isNotSupported ? (
            <span className="text-xs font-bold text-amber-400 bg-amber-950/50 px-2 py-1 rounded border border-amber-800/60 font-mono">
              Not Supported
            </span>
          ) : (
            <>
              <motion.span 
                key={value !== null ? value : 'null'}
                initial={{ scale: 0.9, opacity: 0.8 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="text-3xl font-extrabold text-white font-['Chakra_Petch',sans-serif] tracking-tight"
              >
                {value !== null && value !== undefined ? (typeof value === 'number' ? value.toLocaleString() : value) : '---'}
              </motion.span>
              <span className={`text-xs font-bold ${activeTextColor} tracking-widest mt-1 font-mono`}>
                {unit}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="w-full flex justify-between items-center text-[11px] font-mono text-slate-500 mt-3 pt-3 border-t border-slate-800/80">
        <span>Min: {min}</span>
        <span className="text-slate-400 font-bold">{Math.round(percentage * 100)}%</span>
        <span>Max: {max}</span>
      </div>
    </div>
  );
};
