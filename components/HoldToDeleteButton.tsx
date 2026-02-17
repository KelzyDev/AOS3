
import React, { useState, useRef } from 'react';
import { Trash2 } from 'lucide-react';

interface HoldToDeleteButtonProps {
  onDelete: () => void;
  className?: string;
  children?: React.ReactNode;
  label?: string; // For aria-label
}

export const HoldToDeleteButton: React.FC<HoldToDeleteButtonProps> = ({ onDelete, className, children, label }) => {
  const [isHolding, setIsHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<number | null>(null);

  const startHold = () => {
    setIsHolding(true);
    let currentProgress = 0;
    
    // Clear any existing interval just in case
    if (intervalRef.current) window.clearInterval(intervalRef.current);

    intervalRef.current = window.setInterval(() => {
      currentProgress += 4; // Approx 1 second to fill (4% * 25 steps)
      if (currentProgress >= 100) {
        currentProgress = 100;
        completeHold();
      }
      setProgress(currentProgress);
    }, 30);
  };

  const completeHold = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    setIsHolding(false);
    setProgress(0);
    onDelete();
  };

  const cancelHold = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    setIsHolding(false);
    setProgress(0);
  };

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      className={`relative overflow-hidden select-none ${className || ''} ${isHolding ? 'bg-red-50' : ''}`}
      title={label || "Hold to delete"}
      aria-label={label || "Hold to delete"}
    >
      {/* Background Progress Fill */}
      <div 
        className="absolute bottom-0 left-0 h-full bg-red-200 transition-all duration-75 ease-linear opacity-50 pointer-events-none"
        style={{ width: `${progress}%` }}
      />
      
      {/* Content */}
      <div className="relative z-10 flex items-center justify-center gap-2">
        {children || <Trash2 size={14} className={progress > 0 ? "text-red-700" : "text-gray-400 group-hover:text-red-600"} />}
      </div>
    </button>
  );
};
