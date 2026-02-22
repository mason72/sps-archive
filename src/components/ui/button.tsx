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
          "inline-flex items-center justify-center rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            primary:
              "bg-stone-900 text-white hover:bg-stone-800 active:bg-stone-950 focus-visible:ring-stone-500",
            secondary:
              "bg-stone-100 text-stone-900 hover:bg-stone-200 active:bg-stone-300 focus-visible:ring-stone-400",
            ghost:
              "text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-stone-400",
            danger:
              "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500",
          }[variant],
          {
            sm: "h-8 gap-1.5 px-3 text-sm",
            md: "h-10 gap-2 px-4 text-sm",
            lg: "h-12 gap-2.5 px-6 text-base",
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
