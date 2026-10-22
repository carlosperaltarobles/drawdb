import { describe, expect, it } from "vitest";
import { createMembersLoader } from "./membersLoader";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe("members request lifecycle", () => {
  it("ignores a response after closing or replacing the project", async () => {
    const pending = deferred();
    const data = [];
    const loader = createMembersLoader({
      load: () => pending.promise,
      onData: (d) => data.push(d),
      onError: () => {},
    });
    const running = loader.run();
    loader.dispose();
    pending.resolve({ members: [{ userId: "old" }], invitations: [] });
    await running;
    expect(data).toEqual([]);
  });
  it("keeps the newest response if requests finish in reverse order", async () => {
    const old = deferred();
    const latest = deferred();
    const data = [];
    let calls = 0;
    const loader = createMembersLoader({
      load: () => (++calls === 1 ? old.promise : latest.promise),
      onData: (d) => data.push(d),
      onError: () => {},
    });
    const first = loader.run();
    const second = loader.run();
    latest.resolve("latest");
    await second;
    old.resolve("old");
    await first;
    expect(data).toEqual(["latest"]);
  });
  it("reloads authoritative membership after a mutation fails", async () => {
    const data = [];
    const errors = [];
    const failure = new Error("forbidden");
    const loader = createMembersLoader({
      load: async () => ({ members: [], invitations: [] }),
      onData: (d) => data.push(d),
      onError: (e) => errors.push(e),
    });
    await loader.run(async () => {
      throw failure;
    });
    expect(data).toEqual([{ members: [], invitations: [] }]);
    expect(errors).toContain(failure);
  });
});
