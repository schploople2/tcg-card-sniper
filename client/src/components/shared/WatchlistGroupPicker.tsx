import { useState } from "react";
import { FolderPlus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateGroup } from "@/hooks/useWatchlistGroups";
import type { WatchlistGroup } from "@/types";

/**
 * Sentinel values for the picker. Radix Select disallows empty strings as
 * item values, and we need a distinct token both for "no group" (Ungrouped)
 * and "open the new-group dialog" rows. Keeping them in one place makes
 * the onValueChange dispatch tidy.
 */
export const UNGROUPED_VALUE = "__ungrouped__";
export const NEW_GROUP_VALUE = "__new__";

type Props = {
  value: string | null;
  groups: WatchlistGroup[];
  /** Called with a group id, or null when the user picks "Ungrouped". */
  onChange: (groupId: string | null) => void;
  /** Visual variant. `chip` is the compact inline pill on a card; `form`
   *  is the full-height field used inside the add-card dialog. */
  variant?: "chip" | "form";
  disabled?: boolean;
  /** When supplied, the picker exposes a "+ New group..." row that opens a
   *  prompt to create a group and auto-selects it on success. Defaults
   *  to true; pass false on surfaces that shouldn't grow new groups. */
  allowCreate?: boolean;
};

export function WatchlistGroupPicker({
  value,
  groups,
  onChange,
  variant = "chip",
  disabled,
  allowCreate = true,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const createGroup = useCreateGroup();

  const selectValue = value === null ? UNGROUPED_VALUE : value;

  function handleValueChange(v: string) {
    if (v === NEW_GROUP_VALUE) {
      setNewName("");
      setNewOpen(true);
      return;
    }
    if (v === UNGROUPED_VALUE) {
      onChange(null);
      return;
    }
    onChange(v);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    createGroup.mutate(trimmed, {
      onSuccess: (group) => {
        setNewOpen(false);
        onChange(group.id);
      },
    });
  }

  const triggerClass =
    variant === "chip"
      ? "h-7 w-auto min-w-[8rem] px-2 py-0 text-xs border-slate-700/70 bg-slate-900/40"
      : "h-9";

  return (
    <>
      <Select value={selectValue} onValueChange={handleValueChange} disabled={disabled}>
        <SelectTrigger
          className={triggerClass}
          aria-label="Watchlist group"
          data-testid="watchlist-group-picker"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNGROUPED_VALUE}>Ungrouped</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
          {allowCreate && (
            <SelectItem value={NEW_GROUP_VALUE} className="text-[#F5C518]">
              <span className="inline-flex items-center gap-1.5">
                <FolderPlus className="h-3.5 w-3.5" />
                New group…
              </span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      <Dialog open={newOpen} onOpenChange={(v) => !v && setNewOpen(false)}>
        <DialogContent className="bg-[#0f172a] border-slate-800 text-slate-100 max-w-sm">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. High Priority Cards"
              maxLength={60}
              data-testid="new-group-name-input"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNewOpen(false)}
                disabled={createGroup.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newName.trim() || createGroup.isPending}
                className="bg-[#F5C518] hover:bg-[#e0b416] text-slate-900"
                data-testid="new-group-submit"
              >
                {createGroup.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
