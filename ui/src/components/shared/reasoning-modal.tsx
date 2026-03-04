import type { ReasoningDTO } from "@shared/api-types";
import { useState } from "react";
import { ReasoningSections } from "@/components/shared/reasoning-sections";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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
            <div className="pr-4">
              <ReasoningSections reasoning={reasoning} />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
