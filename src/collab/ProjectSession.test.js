import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSession } from "./ProjectSession";

const doc = () => ({
  database: "generic",
  sqlHeader: "",
  tables: [{ id: "t", fields: [] }],
  relationships: [],
  notes: [],
  areas: [],
  views: [],
  enums: [],
  types: [],
});
const field = (id) => ({
  t: "sadd",
  coll: "tables",
  id: "t",
  sub: "fields",
  item: { id },
  index: 0,
});
function setup() {
  const listeners = new Map();
  const sent = [];
  const socket = {
    on: (event, fn) => listeners.set(event, fn),
    off: (event) => listeners.delete(event),
    connect() {},
    disconnect() {},
    emit: (...args) => sent.push(args),
    volatile: { emit: (...args) => sent.push(args) },
  };
  const applied = [];
  const states = [];
  const exits = [];
  const notices = [];
  const session = new ProjectSession({
    projectId: "p",
    socket,
    onState: (state) => states.push(state),
    onExit: (reason) => exits.push(reason),
    onNotice: (notice) => notices.push(notice),
  });
  session.registerAppliers((next, previous, reset) =>
    applied.push({ next, previous, reset }),
  );
  session.start();
  const receive = (event, payload) => listeners.get(event)?.(payload);
  const snapshot = (value = doc(), version = 0, role = "editor", epoch) =>
    sent
      .filter(([event]) => event === "join")
      .at(-1)[2]({
        ok: true,
        doc: value,
        version,
        epoch,
        role,
        name: "Team",
        peers: [],
      });
  receive("connect");
  return {
    session,
    sent,
    receive,
    snapshot,
    applied,
    states,
    exits,
    notices,
    listeners,
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("ProjectSession", () => {
  it("does not send default editor state before hydration and limits local batches to 50ms", () => {
    const { session, snapshot, sent } = setup();
    session.observe(doc());
    snapshot();
    session.observe(doc());
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toEqual([]);
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "n" }] });
    session.observe({ ...initial, notes: [{ id: "n", title: "hello" }] });
    vi.advanceTimersByTime(49);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent.filter(([e]) => e === "ops")).toEqual([
      [
        "ops",
        {
          seq: 1,
          ops: [
            {
              t: "add",
              coll: "notes",
              item: { id: "n", title: "hello" },
              index: 0,
            },
          ],
        },
      ],
    ]);
  });
  it("keeps an unsent local column when a remote column arrives before the timer", () => {
    const { session, snapshot, receive, applied, sent } = setup();
    snapshot();
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({
      ...initial,
      tables: [{ id: "t", fields: [{ id: "local" }] }],
    });
    receive("ops", { version: 1, ops: [field("remote")] });
    expect(applied.at(-1).next.tables[0].fields).toEqual([
      { id: "local" },
      { id: "remote" },
    ]);
    session.observe(applied.at(-1).next);
    vi.advanceTimersByTime(50);
    expect(sent.filter(([e]) => e === "ops")[0][1].ops).toEqual([
      field("local"),
    ]);
    receive("ack", { seq: 1, version: 2, ok: true });
    session.observe(applied.at(-1).next);
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(1);
  });
  it("uses the newest remote state if it arrives before workspace hydration", async () => {
    const { session, snapshot, receive, sent } = setup();
    const waiting = session.waitForSnapshot();
    snapshot();
    await waiting;
    receive("ops", { version: 1, ops: [field("remote")] });
    const initial = session.hydrate();
    expect(initial.tables[0].fields).toEqual([{ id: "remote" }]);
    session.observe(initial);
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(0);
  });
  it("drops delayed and unacknowledged work on disconnect and refuses stale hydration after reconnect", () => {
    const { session, snapshot, receive, sent, applied } = setup();
    snapshot();
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "pending" }] });
    vi.advanceTimersByTime(50);
    session.observe({ ...initial, notes: [{ id: "unsent" }] });
    receive("disconnect");
    vi.advanceTimersByTime(100);
    receive("connect");
    const latest = { ...doc(), notes: [{ id: "server" }] };
    snapshot(latest, 5);
    session.observe(initial);
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(1);
    expect(applied.at(-1).next).toBe(latest);
    session.observe(latest);
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(1);
  });
  it("rejoins on version gaps and explicit resync without flushing stale work", () => {
    const { session, snapshot, receive, sent } = setup();
    snapshot();
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "unsent" }] });
    receive("ops", { version: 3, ops: [] });
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "join")).toHaveLength(2);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(0);
    snapshot(doc(), 3);
    receive("resync");
    expect(sent.filter(([e]) => e === "join")).toHaveLength(3);
  });
  it("ignores callbacks from disposed mounts and supports StrictMode restart", () => {
    const { session, snapshot, receive, sent, states } = setup();
    const oldJoin = sent[0][2];
    session.stop();
    session.start();
    receive("connect");
    oldJoin({
      ok: true,
      doc: doc(),
      version: 0,
      role: "admin",
      name: "Wrong",
      peers: [],
    });
    expect(states.at(-1).status).toBe("connecting");
    snapshot();
    expect(states.at(-1).projectName).toBe("Team");
    session.stop();
    vi.advanceTimersByTime(100);
    expect(states.at(-1).status).toBe("online");
  });
  it("blocks viewer edits and clears queued edits immediately on demotion", () => {
    const { session, snapshot, receive, sent } = setup();
    snapshot(doc(), 0, "viewer");
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "illegal" }] });
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(0);
    receive("role_changed", { role: "editor" });
    snapshot();
    session.observe(session.hydrate());
    session.observe({ ...initial, notes: [{ id: "pending" }] });
    receive("role_changed", { role: "viewer" });
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(0);
  });
  it("handles revoked access and ignores later join callbacks", () => {
    const { session, receive, snapshot, exits, states } = setup();
    receive("access_revoked");
    snapshot();
    expect(exits).toEqual(["access_revoked"]);
    expect(states.at(-1).status).not.toBe("online");
    expect(session.canWrite()).toBe(false);
  });
  it("throttles awareness and clears peers on disconnect", () => {
    const { session, snapshot, receive, sent, states } = setup();
    snapshot();
    session.sendAwareness({ cursor: { x: 1, y: 2 } });
    session.sendAwareness({ cursor: null });
    vi.advanceTimersByTime(50);
    expect(sent.filter(([e]) => e === "awareness")).toEqual([
      ["awareness", { cursor: null }],
    ]);
    receive("presence", {
      peers: [{ userId: "u", name: "User", color: "blue" }],
    });
    receive("awareness", {
      userId: "u",
      cursor: { x: 2, y: 3 },
      linking: null,
    });
    expect(states.at(-1).awareness.get("u").name).toBe("User");
    receive("disconnect");
    expect(states.at(-1).peers).toEqual([]);
    expect(states.at(-1).awareness.size).toBe(0);
  });
  it("envía el epoch recibido en join con cada lote", () => {
    const { session, snapshot, sent } = setup();
    snapshot(doc(), 0, "editor", 3);
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "n" }] });
    vi.advanceTimersByTime(50);
    const opsSent = sent.filter(([e]) => e === "ops");
    expect(opsSent).toHaveLength(1);
    expect(opsSent[0][1].epoch).toBe(3);
  });
  it("en previsualización los ops remotos se acumulan y se muestran al salir", () => {
    const { session, snapshot, receive, applied, sent, states } = setup();
    snapshot();
    const initial = session.hydrate();
    session.observe(initial);
    const otroDoc = { ...doc(), notes: [{ id: "preview-note" }] };
    const meta = { id: "s1", createdAt: "2026-10-23T12:00:00.000Z" };
    session.startPreview(otroDoc, meta);
    expect(states.at(-1).preview).toEqual(meta);
    expect(applied.at(-1)).toEqual({
      next: otroDoc,
      previous: initial,
      reset: false,
    });
    const appliedBeforeRemote = applied.length;
    receive("ops", { version: 1, ops: [field("remote")] });
    expect(applied).toHaveLength(appliedBeforeRemote);
    session.observe(otroDoc);
    session.observe({ ...otroDoc, notes: [{ id: "changed-in-preview" }] });
    session.sendAwareness({ cursor: { x: 10, y: 20 } });
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(0);
    expect(sent.filter(([e]) => e === "awareness")).toHaveLength(0);
    session.endPreview();
    expect(states.at(-1).preview).toBeNull();
    expect(applied.at(-1).previous).toBe(otroDoc);
    expect(applied.at(-1).reset).toBe(false);
    expect(applied.at(-1).next.tables[0].fields).toEqual([{ id: "remote" }]);
  });
  it("restored durante la previsualización sale de ella y hace join", () => {
    const { session, snapshot, receive, applied, sent, states, notices } =
      setup();
    snapshot();
    const initial = session.hydrate();
    session.observe(initial);
    const otroDoc = { ...doc(), notes: [{ id: "preview-note" }] };
    session.startPreview(otroDoc, { id: "s1" });
    const joinsBefore = sent.filter(([e]) => e === "join").length;
    receive("restored", {
      by: { id: "u", name: "Ana" },
      snapshotCreatedAt: "2026-10-23T12:40:00.000Z",
    });
    expect(states.at(-1).preview).toBeNull();
    expect(states.at(-1).lastRestoredAt).toBeGreaterThan(0);
    expect(sent.filter(([e]) => e === "join")).toHaveLength(joinsBefore + 1);
    expect(notices).toEqual([
      {
        type: "restored",
        by: { id: "u", name: "Ana" },
        snapshotCreatedAt: "2026-10-23T12:40:00.000Z",
      },
    ]);
    const restoredDoc = { ...doc(), notes: [{ id: "restored" }] };
    snapshot(restoredDoc, 4, "editor", 1);
    expect(applied.at(-1)).toEqual({
      next: restoredDoc,
      previous: initial,
      reset: true,
    });
  });
  it("canWrite es false durante la previsualización", () => {
    const { session, snapshot } = setup();
    snapshot();
    const initial = session.hydrate();
    session.observe(initial);
    expect(session.canWrite()).toBe(true);
    session.startPreview({ ...doc(), notes: [{ id: "p" }] }, { id: "s1" });
    expect(session.canWrite()).toBe(false);
    session.endPreview();
    expect(session.canWrite()).toBe(true);
  });
  it("envía la edición local pendiente al empezar una previsualización", () => {
    const { session, snapshot, sent } = setup();
    snapshot();
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "pending" }] });
    session.startPreview({ ...doc(), notes: [{ id: "p" }] }, { id: "s1" });
    const opsSent = sent.filter(([e]) => e === "ops");
    expect(opsSent).toHaveLength(1);
    expect(opsSent[0][1].ops).toEqual([
      { t: "add", coll: "notes", item: { id: "pending" }, index: 0 },
    ]);
  });
  it("flushPendingOps y waitForAckedVersion envían diff pendiente una sola vez y esperan ack", async () => {
    const { session, snapshot, receive, sent } = setup();
    snapshot(doc(), 2);
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "n-flush" }] });

    const waitPromise = session.waitForAckedVersion();
    const opsSent = sent.filter(([e]) => e === "ops");
    expect(opsSent).toHaveLength(1);
    expect(opsSent[0][1].seq).toBe(1);

    // Timer was cancelled so advancing 100ms does not send duplicate batch
    vi.advanceTimersByTime(100);
    expect(sent.filter(([e]) => e === "ops")).toHaveLength(1);

    let resolved = null;
    waitPromise.then((val) => {
      resolved = val;
    });
    await Promise.resolve();
    expect(resolved).toBeNull();

    receive("ack", { seq: 1, version: 3, ok: true });
    const acked = await waitPromise;
    expect(acked.version).toBe(3);
    expect(acked.doc.notes).toEqual([{ id: "n-flush" }]);
  });

  it("waitForAckedVersion rechaza si la sesión pasa a offline antes del ack", async () => {
    const { session, snapshot, receive } = setup();
    snapshot(doc(), 1);
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "n-drop" }] });

    const waitPromise = session.waitForAckedVersion();
    receive("disconnect");
    await expect(waitPromise).rejects.toThrow("offline");
  });

  it("waitForAckedVersion / flushPending rechaza por timeout si el ack nunca llega", async () => {
    const { session, snapshot } = setup();
    snapshot(doc(), 1);
    const initial = session.hydrate();
    session.observe(initial);
    session.observe({ ...initial, notes: [{ id: "n-timeout" }] });

    const waitPromise = session.flushPending({ timeoutMs: 250 });
    vi.advanceTimersByTime(300);
    await expect(waitPromise).rejects.toThrow("timeout");
  });
});
