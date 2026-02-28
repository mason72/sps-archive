import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
          {
            primary:
              "bg-stone-900 text-white hover:bg-stone-800 active:bg-stone-950 rounded-none tracking-wide",
            secondary:
              "border border-stone-200 bg-white text-stone-900 hover:border-stone-300 hover:bg-stone-50 rounded-none",
            ghost:
              "text-stone-500 hover:text-stone-900 rounded-none",
            danger:
              "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 rounded-none",
          }[variant],
          {
            sm: "h-8 gap-1.5 px-4 text-[12px] uppercase tracking-[0.15em]",
            md: "h-10 gap-2 px-5 text-[13px] uppercase tracking-[0.12em]",
            lg: "h-12 gap-2.5 px-8 text-[13px] uppercase tracking-[0.15em]",
          }[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
export { Button };
