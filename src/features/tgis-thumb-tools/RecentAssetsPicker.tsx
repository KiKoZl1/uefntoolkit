import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type RecentAssetItem = {
  id: string;
  image_url: string;
  title?: string;
  canDelete?: boolean;
  kind?: "asset" | "action";
  actionLabel?: string;
};

type RecentAssetsPickerProps = {
  items: RecentAssetItem[];
  selectedId?: string | null;
  onSelect: (item: RecentAssetItem) => void;
  onDelete?: (item: RecentAssetItem) => Promise<void> | void;
  className?: string;
  maxHeightClassName?: string;
  emptyText?: string;
};

export default function RecentAssetsPicker({
  items,
  selectedId,
  onSelect,
  onDelete,
  className,
  maxHeightClassName = "max-h-[180px]",
  emptyText = "Sem assets recentes.",
}: RecentAssetsPickerProps) {
  const [pendingDelete, setPendingDelete] = useState<RecentAssetItem | null>(null);
  const [deletingId, setDeletingId] = useState<string>("");

  const safeItems = useMemo(
    () =>
      items.filter((x) => {
        if (!String(x.id || "").trim()) return false;
        if ((x.kind || "asset") === "action") return true;
        return Boolean(String(x.image_url || "").trim());
      }),
    [items],
  );

  async function confirmDelete() {
    if (!pendingDelete || !onDelete) return;
    setDeletingId(pendingDelete.id);
    try {
      await onDelete(pendingDelete);
      setPendingDelete(null);
    } finally {
      setDeletingId("");
    }
  }

  return (
    <>
      <div className={cn("grid grid-cols-3 gap-2 overflow-y-auto rounded border border-border/60 p-2", maxHeightClassName, className)}>
        {safeItems.length === 0 ? (
          <div className="col-span-3 py-4 text-center text-xs text-muted-foreground">{emptyText}</div>
        ) : null}

        {safeItems.map((item) => {
          if ((item.kind || "asset") === "action") {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className="group relative flex aspect-video flex-col items-center justify-center rounded border border-dashed border-white/20 bg-card/30 transition hover:border-primary/70 hover:bg-primary/5"
                title={item.title || item.actionLabel || "Ação"}
              >
                <span className="mb-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/90 transition group-hover:border-primary group-hover:text-primary">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="px-2 text-center text-[11px] text-muted-foreground">{item.actionLabel || "Adicionar"}</span>
              </button>
            );
          }

          const selected = selectedId && selectedId === item.id;
          const deleting = deletingId === item.id;
          return (
            <div
              key={item.id}
              className={cn(
                "group relative overflow-hidden rounded border transition",
                selected ? "border-primary ring-1 ring-primary" : "border-border/60 hover:border-primary/60",
              )}
              title={item.title || item.id}
            >
              <button type="button" onClick={() => onSelect(item)} className="block w-full">
                <img src={item.image_url} alt={item.title || item.id} className="aspect-video w-full object-cover" />
              </button>
              {onDelete && item.canDelete !== false ? (
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setPendingDelete(item);
                  }}
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-black/30 bg-black/65 text-white opacity-0 transition group-hover:opacity-100"
                  aria-label="Delete asset"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar imagem?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação remove a imagem dos assets recentes. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={Boolean(deletingId)}>
              {deletingId ? "Deletando..." : "Deletar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
