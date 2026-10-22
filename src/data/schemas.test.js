import { describe, it, expect } from "vitest";
import { Validator } from "jsonschema";
import { areaSchema, noteSchema } from "./schemas";

const area = {
  name: "area_0",
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  color: "#175e7a",
};
const note = {
  x: 0,
  y: 0,
  title: "note_0",
  content: "",
  color: "#fcf7ac",
  height: 88,
};

describe.each([
  ["area", areaSchema, area],
  ["note", noteSchema, note],
])("%s schema", (_, schema, element) => {
  it.each([
    ["nanoid", "V1StGXR8_Z5jdHi6B-myT"],
    ["legacy numeric", 0],
  ])("accepts a %s id", (__, id) => {
    expect(new Validator().validate({ ...element, id }, schema).valid).toBe(
      true,
    );
  });
});
