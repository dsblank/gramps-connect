// Checks records before the Evidence Board sends them. POST /api/transactions/
// stores records exactly as sent and doesn't validate them, so a malformed
// record would go straight into the tree. Ported from the Gramplet worker's
// Python checks (pyodidePoc/changesBootstrap.ts, "Validation"), which follow
// gramps-web-api's own validate_object_dict():
//
// 1. Gramps' own JSON Schema for the record type (get_schema()), with ajv.
// 2. No field a Gramps class doesn't have, on the record or any nested
//    object (the schemas don't forbid extra fields).
// 3. References (ChildRef, EventRef, MediaRef, ...) must point at something.
// 4. A Date must carry as many `dateval` values as its modifier needs
//    (a range or span needs both ends).
//
// Schemas, field lists and date rules come from data/grampsSchemas.json,
// generated from Gramps by scripts/export-gramps-record-shapes.py.
import Ajv, { type ValidateFunction } from "ajv";
import data from "../../data/grampsSchemas.json";
import type { GrampsRecord } from "./records";

const SCHEMAS = data.schemas as Record<string, object>;
const CLASS_KEYS = new Map(Object.entries(data.class_keys as Record<string, string[]>).map(([c, keys]) => [c, new Set(keys)]));
const MIN_DATEVAL = data.date.min_dateval as Record<string, number>;
const REF_CLASSES = new Set(["ChildRef", "EventRef", "MediaRef", "PersonRef", "PlaceRef", "RepoRef"]);

// Gramps' schemas use only standard keywords; formats aren't checked (as in
// the Python validators), and strict mode would trip on Gramps' "title"s.
const ajv = new Ajv({ strict: false, validateFormats: false });
const validators = new Map<string, ValidateFunction>();

function validatorFor(cls: string): ValidateFunction {
  let validate = validators.get(cls);
  if (!validate) {
    const schema = SCHEMAS[cls];
    if (!schema) throw new RecordValidationError(`unknown record type ${cls}`);
    validate = ajv.compile(schema);
    validators.set(cls, validate);
  }
  return validate;
}

export class RecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordValidationError";
  }
}

function checkNested(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkNested(item, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const cls = typeof object._class === "string" ? object._class : null;
  if (cls) {
    const known = CLASS_KEYS.get(cls);
    if (known) {
      const unknown = Object.keys(object).filter((k) => !known.has(k));
      if (unknown.length) throw new RecordValidationError(`${path}: unknown ${cls} field(s) ${unknown.join(", ")}`);
    }
    if (REF_CLASSES.has(cls) && !object.ref) throw new RecordValidationError(`${path}: a ${cls} must point at a record`);
    if (cls === "Date") {
      const needed = MIN_DATEVAL[String(object.modifier ?? 0)];
      const dateval = object.dateval;
      if (needed !== undefined && (!Array.isArray(dateval) || dateval.length < needed)) {
        throw new RecordValidationError(`${path}: this kind of date needs ${needed} values in dateval`);
      }
    }
  }
  for (const [key, item] of Object.entries(object)) checkNested(item, `${path}.${key}`);
}

/** Throws a RecordValidationError naming the record and the problem. */
export function validateRecord(record: GrampsRecord): void {
  const name = `${record._class} ${record.gramps_id || record.handle}`;
  // `complete` (Family) is stored but not in Gramps' schema; the Python
  // validators leave it out the same way.
  const { complete: _complete, ...forSchema } = record;
  const validate = validatorFor(record._class);
  if (!validate(forSchema)) {
    const error = validate.errors?.[0];
    throw new RecordValidationError(`${name}: ${error?.instancePath || "(record)"} ${error?.message ?? "is not valid"}`);
  }
  try {
    checkNested(record, "");
  } catch (err) {
    throw new RecordValidationError(`${name}: ${(err as Error).message}`);
  }
}

export function validateRecords(records: GrampsRecord[]): void {
  for (const record of records) validateRecord(record);
}
