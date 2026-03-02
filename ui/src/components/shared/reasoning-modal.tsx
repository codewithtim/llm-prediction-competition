import type { ReasoningDTO } from "@shared/api-types";
import { Fragment, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function ReasoningCell({
  reasoning,
  market,
}: {
  reasoning: ReasoningDTO | null;
  market?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!reasoning) return <span className="text-zinc-500">--</span>;

  return (
    <>
      <button
        type="button"
        className="text-left text-zinc-400 max-w-64 truncate hover:text-zinc-200 transition-colors cursor-pointer"
        onClick={() => setOpen(true)}
        title="Click to view full reasoning"
      >
        {reasoning.summary}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Reasoning</DialogTitle>
            {market && <DialogDescription className="text-zinc-400">{market}</DialogDescription>}
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
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
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
