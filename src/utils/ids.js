import { nanoid } from "nanoid";

export const newId = () => nanoid();

// Ids may be legacy numbers (0, 1, 2) or nanoid strings: compare strictly.
export const findById = (list, id) => list.find((e) => e.id === id);

export const removeById = (list, id) => list.filter((e) => e.id !== id);

// Collapse keys are strings; map them back to the real (maybe numeric) id.
export const resolveId = (list, key) =>
  list.find((e) => `${e.id}` === `${key}`)?.id ?? key;

// Puts `item` back at `index`; without a valid index it goes to the end.
export const insertAt = (list, item, index = list.length) => {
  const position = Math.min(index, list.length);
  return [...list.slice(0, position), item, ...list.slice(position)];
};
