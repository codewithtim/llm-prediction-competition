import type { ReasoningDTO } from "@shared/api-types";
import { Fragment } from "react";
import { Separator } from "@/components/ui/separator";

export function ReasoningSections({ reasoning }: { reasoning: ReasoningDTO }) {
  return (
    <div className="space-y-4">
      {reasoning.sections.map((section, i) => (
        <Fragment key={section.label}>
          {i > 0 && <Separator className="bg-zinc-800" />}
          <div>
            <h4 className="text-sm font-medium text-zinc-200 mb-1">{section.label}</h4>
            {section.data && Object.keys(section.data).length > 0 ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                {Object.entries(section.data).map(([k, v]) => (
                  <Fragment key={k}>
                    <span className="text-zinc-500">{k}</span>
                    <span className="text-zinc-300">
                      {typeof v === "number" ? v.toFixed(4) : String(v)}
                    </span>
                  </Fragment>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400 leading-relaxed">{section.content}</p>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
