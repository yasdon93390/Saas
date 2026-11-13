import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-action text-white hover:bg-action-hover",
  secondary: "border border-line bg-surface text-ink hover:bg-canvas",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
  ghost: "text-ink-soft hover:bg-canvas hover:text-ink",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  const sizing = size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm";
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${VARIANTS[variant]}`;
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "sm" };

export function Button({ variant = "primary", size = "md", className = "", ...props }: Props) {
  return <button className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}
