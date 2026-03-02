import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ReasoningCell({ text, market }: { text: string; market?: string }) {
  const [open, setOpen] = useState(false);

  if (!text) return <span className="text-zinc-500">--</span>;

  return (
    <>
      <button
        type="button"
        className="text-left text-zinc-400 max-w-64 truncate hover:text-zinc-200 transition-colors cursor-pointer"
        onClick={() => setOpen(true)}
        title="Click to view full reasoning"
      >
        {text}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Reasoning</DialogTitle>
            {market && <DialogDescription className="text-zinc-400">{market}</DialogDescription>}
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed pr-4">
              {text}
            </p>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
