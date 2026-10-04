import { useEffect, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Drag-to-rearrange. Calls onMove with the item's new neighbours so the
 * server can give it a sort key between them (one row changes).
 */
export function Sortable<T extends { _id: string }>({
  items,
  render,
  onMove,
  layout = "grid",
  className,
  disabled = false,
}: {
  items: T[];
  render: (item: T, handle: { dragging: boolean }) => ReactNode;
  onMove: (id: T["_id"], before: T["_id"] | null, after: T["_id"] | null) => void;
  layout?: "grid" | "list";
  className?: string;
  disabled?: boolean;
}) {
  const [order, setOrder] = useState(items);
  useEffect(() => setOrder(items), [items]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((i) => i._id === active.id);
    const to = order.findIndex((i) => i._id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    onMove(next[to]._id, next[to - 1]?._id ?? null, next[to + 1]?._id ?? null);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={order.map((i) => i._id)}
        strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
        disabled={disabled}
      >
        <div className={className}>
          {order.map((item) => (
            <SortableItem key={item._id} id={item._id}>
              {(dragging) => render(item, { dragging })}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, children }: { id: string; children: (dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`sortable${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role={undefined}
      tabIndex={undefined}
    >
      {children(isDragging)}
    </div>
  );
}
