import { useContext } from "react";
import {
  TransformContext,
  TransformReaderContext,
} from "../context/TransformContext";

export default function useTransform() {
  return useContext(TransformContext);
}

/** Stable reader of the current transform; does not re-render on pan/zoom. */
export function useGetTransform() {
  return useContext(TransformReaderContext);
}
