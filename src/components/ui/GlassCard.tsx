import React from 'react';
import { cn } from '../../utils/cn'; // We'll create a simple utility to merge tailwind classes

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  glowColor?: 'cyan' | 'purple' | 'emerald' | 'none';
  hoverEffect?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className,
  glowColor = 'none',
  hoverEffect = false,
  ...props
}) => {
  const glowClasses = {
    cyan: 'border-[rgba(0,240,255,0.15)] shadow-[0_0_20px_rgba(0,240,255,0.03)] hover:shadow-[0_0_25px_rgba(0,240,255,0.08)]',
    purple: 'border-[rgba(168,85,247,0.15)] shadow-[0_0_20px_rgba(168,85,247,0.03)] hover:shadow-[0_0_25px_rgba(168,85,247,0.08)]',
    emerald: 'border-[rgba(16,185,129,0.15)] shadow-[0_0_20px_rgba(16,185,129,0.03)] hover:shadow-[0_0_25px_rgba(16,185,129,0.08)]',
    none: 'border-[rgba(255,255,255,0.05)] shadow-[0_4px_30px_rgba(0,0,0,0.4)]'
  };

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-[rgba(17,24,39,0.7)] backdrop-blur-md p-6 text-white transition-all duration-300",
        glowClasses[glowColor],
        hoverEffect && "hover:translate-y-[-2px] hover:bg-[rgba(17,24,39,0.8)] hover:border-[rgba(0,240,255,0.25)]",
        className
      )}
      {...props}
    >
      {/* Decorative inner glow line */}
      <div className="absolute inset-[1px] -z-10 rounded-xl bg-gradient-to-b from-[rgba(255,255,255,0.05)] to-transparent pointer-events-none" />
      {children}
    </div>
  );
};
