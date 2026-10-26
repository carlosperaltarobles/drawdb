export const SYNTHETIC_SIZES = [200, 500, 1000];

const TABLE_COLORS = [
  "#175e7a",
  "#2f68ad",
  "#0f766e",
  "#4338ca",
  "#7c2d12",
  "#15803d",
  "#6d28d9",
  "#b45309",
];

const DOMAINS = [
  "identity",
  "billing",
  "catalog",
  "inventory",
  "logistics",
  "analytics",
  "audit",
  "support",
];

const COLUMN_TYPES = [
  { name: "status", type: "VARCHAR", size: "32", notNull: true, default: "'active'" },
  { name: "code", type: "VARCHAR", size: "64", notNull: true, unique: true, default: "" },
  { name: "amount_cents", type: "BIGINT", size: "", notNull: true, default: "0" },
  { name: "metadata_json", type: "JSONB", size: "", notNull: false, default: "" },
  { name: "created_at", type: "TIMESTAMPTZ", size: "", notNull: true, default: "now()" },
  { name: "updated_at", type: "TIMESTAMPTZ", size: "", notNull: false, default: "" },
];

export function createSyntheticDiagram(
  tableCount = 200,
  { database = "postgresql" } = {},
) {
  const count = Math.max(1, Number(tableCount) || 200);
  const cols = Math.max(10, Math.ceil(Math.sqrt(count)));
  const cellWidth = 340;
  const cellHeight = 320;

  const tables = [];
  const relationships = [];
  const areas = [];
  const notes = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const domain = DOMAINS[i % DOMAINS.length];
    const tableId = `tbl_${i}`;
    const tableName = `${domain}_entity_${i}`;
    const hasParent = i > 0;
    const parentIndex = hasParent ? Math.floor((i - 1) / 2) : -1;
    const parentId = hasParent ? `tbl_${parentIndex}` : null;

    const fields = [
      {
        id: `fld_${i}_pk`,
        name: "id",
        type: "UUID",
        default: "gen_random_uuid()",
        check: "",
        primary: true,
        unique: true,
        notNull: true,
        increment: false,
        comment: `Primary key for ${tableName}`,
        size: "",
      },
    ];

    if (parentId) {
      fields.push({
        id: `fld_${i}_fk`,
        name: `parent_${parentIndex}_id`,
        type: "UUID",
        default: "",
        check: "",
        primary: false,
        unique: false,
        notNull: i % 3 !== 0,
        increment: false,
        comment: `References tbl_${parentIndex}`,
        size: "",
      });
    }

    for (let c = 0; c < 4; c++) {
      const spec = COLUMN_TYPES[(i + c) % COLUMN_TYPES.length];
      fields.push({
        id: `fld_${i}_${c}`,
        name: `${spec.name}_${c}`,
        type: spec.type,
        default: spec.default,
        check: "",
        primary: false,
        unique: Boolean(spec.unique && c === 0),
        notNull: spec.notNull,
        increment: false,
        comment: c === 0 ? `Indexed ${spec.name} attribute` : "",
        size: spec.size,
      });
    }

    tables.push({
      id: tableId,
      name: tableName,
      x: col * cellWidth + 80,
      y: row * cellHeight + 80,
      width: 240,
      locked: false,
      collapsed: false,
      hidden: false,
      color: TABLE_COLORS[i % TABLE_COLORS.length],
      comment: `Synthetic table #${i} in ${domain} domain`,
      fields,
      indices: [
        {
          id: `idx_${i}_0`,
          name: `idx_${tableName}_lookup`,
          unique: false,
          fields: [fields[fields.length - 2].name],
        },
      ],
      uniqueConstraints: [],
    });

    if (parentId) {
      relationships.push({
        id: `rel_${i}`,
        name: `fk_${tableName}_parent_${parentIndex}`,
        startTableId: tableId,
        startFieldId: `fld_${i}_fk`,
        endTableId: parentId,
        endFieldId: `fld_${parentIndex}_pk`,
        cardinality: "Many to one",
        updateConstraint: "No action",
        deleteConstraint: "Cascade",
        color: "#64748b",
      });
    }
  }

  const areaCount = Math.max(1, Math.ceil(count / 25));
  for (let a = 0; a < areaCount; a++) {
    const col = a % 4;
    const row = Math.floor(a / 4);
    areas.push({
      id: `area_${a}`,
      name: `Domain Group ${a + 1}`,
      x: col * cellWidth * 4 + 40,
      y: row * cellHeight * 3 + 40,
      width: cellWidth * 3.5,
      height: cellHeight * 2.5,
      color: TABLE_COLORS[a % TABLE_COLORS.length],
      locked: false,
    });
  }

  const noteCount = Math.max(1, Math.ceil(count / 50));
  for (let n = 0; n < noteCount; n++) {
    notes.push({
      id: `note_${n}`,
      title: `Architecture Note ${n + 1}`,
      content: `Review partition keys and foreign key indexes for batch ${n + 1}.`,
      x: (n % 5) * 420 + 100,
      y: -160,
      width: 240,
      height: 110,
      color: "#fef08a",
      locked: false,
    });
  }

  return {
    database,
    sqlHeader: "-- Synthetic benchmark schema\n",
    tables,
    relationships,
    notes,
    areas,
    views: [],
    enums: [],
    types: [],
  };
}

export function createSyntheticProposalFixture(
  baseDoc,
  {
    changeCount = 60,
    proposalId = "0199aaaa-0000-7000-8000-000000000101",
    conversationId = "0199aaaa-0000-7000-8000-000000000102",
    revision = 1,
    baseVersion = 1,
  } = {},
) {
  const ops = [];
  const summaryItems = [];
  let added = 0;
  let modified = 0;
  let removed = 0;

  const targetModifyCount = Math.min(
    Math.max(1, changeCount - 4),
    baseDoc.tables.length - 2,
  );

  for (let i = 0; i < targetModifyCount; i++) {
    const tbl = baseDoc.tables[i];
    const nextComment = `${tbl.comment} [AI-audited]`;
    ops.push({
      t: "patch",
      coll: "tables",
      id: tbl.id,
      patch: { comment: nextComment },
    });
    summaryItems.push({
      coll: "tables",
      id: tbl.id,
      change: "modified",
      beforeName: tbl.name,
      afterName: tbl.name,
      properties: ["comment"],
    });
    modified++;
  }

  const nextTables = baseDoc.tables.map((tbl, idx) =>
    idx < targetModifyCount
      ? { ...tbl, comment: `${tbl.comment} [AI-audited]` }
      : tbl,
  );
  const addedTables = [];

  for (let a = 0; a < 2; a++) {
    const newId = `tbl_ai_added_${a}`;
    const newName = `ai_audit_log_${a}`;
    const newTable = {
      id: newId,
      name: newName,
      x: 120 + a * 320,
      y: 120,
      width: 240,
      locked: false,
      collapsed: false,
      hidden: false,
      color: "#0f766e",
      comment: "Added by AI proposal",
      fields: [
        {
          id: `${newId}_pk`,
          name: "id",
          type: "UUID",
          default: "gen_random_uuid()",
          check: "",
          primary: true,
          unique: true,
          notNull: true,
          increment: false,
          comment: "Primary key",
          size: "",
        },
      ],
      indices: [],
      uniqueConstraints: [],
    };
    ops.push({
      t: "add",
      coll: "tables",
      item: newTable,
      index: baseDoc.tables.length + a,
    });
    addedTables.push(newTable);
    summaryItems.push({
      coll: "tables",
      id: newId,
      change: "added",
      afterName: newName,
      properties: ["name", "fields", "comment"],
    });
    added++;
  }

  const addedNoteId = "note_ai_added_0";
  const addedNote = {
    id: addedNoteId,
    title: "AI Summary",
    content: "Added audit tables and updated table descriptions.",
    x: 60,
    y: 60,
    width: 240,
    height: 110,
    color: "#bbf7d0",
    locked: false,
  };
  ops.push({
    t: "add",
    coll: "notes",
    item: addedNote,
    index: baseDoc.notes.length,
  });
  summaryItems.push({
    coll: "notes",
    id: addedNoteId,
    change: "added",
    afterName: "AI Summary",
    properties: ["title", "content"],
  });
  added++;

  let nextNotes = [...baseDoc.notes, addedNote];
  if (baseDoc.notes.length > 0) {
    const removedNote = baseDoc.notes[baseDoc.notes.length - 1];
    ops.push({
      t: "del",
      coll: "notes",
      id: removedNote.id,
    });
    summaryItems.push({
      coll: "notes",
      id: removedNote.id,
      change: "removed",
      beforeName: removedNote.title,
      properties: [],
    });
    nextNotes = nextNotes.filter((n) => n.id !== removedNote.id);
    removed++;
  }

  const afterDoc = {
    ...baseDoc,
    tables: [...nextTables, ...addedTables],
    notes: nextNotes,
  };
  const proposal = {
    id: proposalId,
    revision,
    conversationId,
    requestedModel: "chat-a",
    reportedModel: "fixture-chat-a",
    baseVersion,
    baseHash: `synthetic-base-${baseDoc.tables.length}-v${baseVersion}`,
    status: "pending",
    summary: {
      counts: { added, modified, removed },
      items: summaryItems,
    },
    warnings: [],
    expiresAt: "2026-10-27T12:00:00.000Z",
    appliedVersion: null,
    snapshotId: null,
  };

  return {
    proposal,
    before: baseDoc,
    after: afterDoc,
    ops,
    stale: false,
  };
}
