import type { ButtonHTMLAttributes, ReactNode } from "react";

type AppTabButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  active: boolean;
  className?: string;
  children: ReactNode;
};

export function AppTabButton({ active, className = "", children, type = "button", ...props }: AppTabButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={`app-tab-button ${active ? "app-tab-button-active" : "app-tab-button-inactive"} ${className}`.trim()}
    >
      {children}
    </button>
  );
}
