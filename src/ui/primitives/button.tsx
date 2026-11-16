import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

const VARIANTS = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700",
  secondary: "border border-neutral-700 bg-white text-neutral-900 hover:bg-neutral-100",
} as const;

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-70 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
