import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const BASE_CLASS = "text-zinc-100 hover:text-emerald-400 transition-colors";

export function InternalLink({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: ReactNode;
  to: string;
  params?: Record<string, string>;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    // biome-ignore lint/suspicious/noExplicitAny: spreading rest props into Link requires any
    <Link className={className ? `${BASE_CLASS} ${className}` : BASE_CLASS} {...(props as any)}>
      {children}
    </Link>
  );
}
