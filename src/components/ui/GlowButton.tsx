import React from 'react';
import { cn } from '../../utils/cn';

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'cyan' | 'purple' | 'emerald' | 'ghost';
  glow?: boolean;
}

export const GlowButton: React.FC<GlowButtonProps> = ({
  children,
  className,
  variant = 'cyan',
  glow = true,
  ...props
}) => {
  const variantClasses = {
    cyan: 'bg-transparent border-cyber-cyan text-cyber-cyan hover:bg-cyber-cyan hover:text-black shadow-[0_0_15px_rgba(0,240,255,0.1)] hover:shadow-[0_0_20px_rgba(0,240,255,0.3)]',
    purple: 'bg-transparent border-cyber-purple text-cyber-purple hover:bg-cyber-purple hover:text-white shadow-[0_0_15px_rgba(168,85,247,0.1)] hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]',
    emerald: 'bg-transparent border-cyber-emerald text-cyber-emerald hover:bg-cyber-emerald hover:text-black shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]',
    ghost: 'bg-transparent border-transparent text-gray-400 hover:text-white hover:bg-white/5'
  };

  return (
    <button
      className={cn(
        "relative px-4 py-2 border rounded font-display tracking-wider text-xs uppercase font-medium transition-all duration-300 active:scale-95 cursor-pointer flex items-center justify-center gap-2",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
