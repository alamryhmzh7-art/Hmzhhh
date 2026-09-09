import React from 'react';

interface CircularGaugeProps {
  label: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
  color?: string; // e.g. 'stroke-blue-500', 'stroke-emerald-500', 'stroke-amber-500'
  textColor?: string; // e.g. 'text-blue-500'
  size?: number;
  strokeWidth?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  icon?: React.ReactNode;
  isNotSupported?: boolean;
}

export const CircularGauge: React.FC<CircularGaugeProps> = ({
  label,
  value,
  min,
  max,
  unit,
  color = 'stroke-blue-500',
  textColor = 'text-blue-500',
  size = 170,
  strokeWidth = 10,
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
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center relative overflow-hidden transition-all hover:shadow-md">
      {icon && (
        <div className="absolute top-4 left-4 text-slate-400">
          {icon}
        </div>
      )}
      <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
        {label}
      </span>

      <div className="relative flex items-center justify-center my-2" style={{ width: size, height: size }}>
        <svg className="w-full h-full transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="stroke-slate-100 dark:stroke-slate-800"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className={`${activeColor} transition-all duration-300 ease-out`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        <div className="absolute flex flex-col items-center justify-center text-center px-2">
          {isNotSupported ? (
            <span className="text-xs font-bold text-amber-400 bg-amber-950/40 px-2 py-1 rounded border border-amber-800/50 font-mono">
              Not Supported
            </span>
          ) : (
            <>
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white font-['Chakra_Petch',sans-serif] tracking-tight">
                {value !== null && value !== undefined ? (typeof value === 'number' ? value.toLocaleString() : value) : '---'}
              </span>
              <span className={`text-xs font-bold ${activeTextColor} tracking-widest mt-0.5`}>
                {unit}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="w-full flex justify-between items-center text-[11px] font-mono text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
        <span>Min: {min}</span>
        <span className="text-slate-500 dark:text-slate-300 font-bold">Range [{min} - {max}]</span>
        <span>Max: {max}</span>
      </div>
    </div>
  );
};
