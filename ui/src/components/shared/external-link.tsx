import type { ReactNode } from "react";

export function ExternalLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-zinc-100 underline decoration-zinc-600 hover:decoration-zinc-400 transition-colors"
    >
      {children}
    </a>
  );
}
