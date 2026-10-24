import { useRef } from "react";
import { tablesSameIgnoringLayout } from "../utils/layoutFields";

export default function useLayoutStable(tables) {
  const prevRef = useRef(tables);
  if (!tablesSameIgnoringLayout(prevRef.current, tables)) {
    prevRef.current = tables;
  }
  return prevRef.current;
}
