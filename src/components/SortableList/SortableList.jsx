import { memo, useMemo, useRef } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableItem } from "./SortableItem";

const defaultIsItemEqual = (a, b) => a === b;

const SortableRow = memo(
  function SortableRow({ item, index, renderItem }) {
    return <SortableItem id={item.id}>{renderItem(item, index)}</SortableItem>;
  },
  (prev, next) =>
    prev.index === next.index &&
    prev.renderItem === next.renderItem &&
    next.isItemEqual(prev.item, next.item),
);

export function SortableList({
  items,
  onChange,
  afterChange,
  renderItem,
  keyPrefix,
  isItemEqual = defaultIsItemEqual,
}) {
  const sensors = useSensors(useSensor(PointerSensor));
  const prevIdsRef = useRef([]);

  const itemIds = useMemo(() => {
    const prev = prevIdsRef.current;
    if (
      prev.length === items.length &&
      prev.every((id, index) => id === items[index].id)
    ) {
      return prev;
    }
    const next = items.map((item) => item.id);
    prevIdsRef.current = next;
    return next;
  }, [items]);

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      const newItems = arrayMove(items, oldIndex, newIndex);
      onChange(newItems);
      afterChange();
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {items.map((item, i) => (
          <SortableRow
            key={`${keyPrefix}-sortable-item-${item.id}`}
            item={item}
            index={i}
            renderItem={renderItem}
            isItemEqual={isItemEqual}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

