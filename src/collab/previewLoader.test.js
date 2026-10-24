import { describe, expect, it, vi } from "vitest";
import { createPreviewLoader } from "./previewLoader";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createPreviewLoader", () => {
  it("muestra solo la última versión pedida aunque las respuestas lleguen desordenadas", async () => {
    const first = deferred();
    const second = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const start = vi.fn();
    const load = createPreviewLoader({ fetch, start, onError: vi.fn() });

    const a = load("s1");
    const b = load("s2");
    second.resolve({ id: "s2" });
    await b;
    first.resolve({ id: "s1" });
    await a;

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ id: "s2" });
  });

  it("avisa del error sin rechazar la promesa", async () => {
    const onError = vi.fn();
    const load = createPreviewLoader({
      fetch: vi.fn().mockRejectedValue(new Error("404")),
      start: vi.fn(),
      onError,
    });
    await expect(load("s1")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
