// Minimal, dependency-free schema validation for tool arguments and for the
// structured JSON the planner (LLM) must return. Not a full JSON-Schema
// implementation — just the subset the agent needs: typed fields, required
// keys, enums, and coercion of a few common cases.
//
// A schema is a plain object:
//   { type: 'object', properties: { name: { type:'string', enum:[...] } },
//     required: ['name'], additionalProperties: false }
//
// validate() returns { valid, errors: [string], value } where `value` is a
// shallow-coerced copy (numbers/booleans parsed from strings when unambiguous).

export function validate(schema, input, path = '$') {
  const errors = [];
  const value = check(schema, input, path, errors);
  return { valid: errors.length === 0, errors, value };
}

function check(schema, input, path, errors) {
  if (!schema || typeof schema !== 'object') return input;

  // Union of types (e.g. ['string','null'])
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];

  if (input === undefined || input === null) {
    if (types.includes('null') || schema.optional) return input ?? null;
    if (schema.default !== undefined) return schema.default;
    // Fall through — required handling happens in object branch.
  }

  const primary = types.find((t) => t && t !== 'null') || schema.type;

  switch (primary) {
    case 'object': {
      const obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
      const out = {};
      const props = schema.properties || {};
      const required = schema.required || [];
      for (const key of required) {
        if (obj[key] === undefined || obj[key] === null) {
          if (props[key] && props[key].default !== undefined) continue;
          errors.push(`${path}.${key} is required`);
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        if (obj[key] === undefined) {
          if (sub.default !== undefined) out[key] = sub.default;
          continue;
        }
        out[key] = check(sub, obj[key], `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === true) {
        for (const [k, v] of Object.entries(obj)) if (!(k in props)) out[k] = v;
      }
      return out;
    }
    case 'array': {
      if (!Array.isArray(input)) {
        if (input === undefined || input === null) return schema.default ?? [];
        errors.push(`${path} must be an array`);
        return [];
      }
      if (schema.items) return input.map((el, i) => check(schema.items, el, `${path}[${i}]`, errors));
      return input;
    }
    case 'string': {
      let v = input;
      if (typeof v !== 'string') {
        if (v === undefined || v === null) { if (types.includes('null')) return null; errors.push(`${path} must be a string`); return v; }
        v = String(v);
      }
      if (schema.enum && !schema.enum.includes(v)) {
        errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
      }
      if (schema.minLength && v.length < schema.minLength) errors.push(`${path} is too short`);
      if (schema.maxLength && v.length > schema.maxLength) v = v.slice(0, schema.maxLength);
      return v;
    }
    case 'number':
    case 'integer': {
      let v = input;
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v);
      if (typeof v !== 'number' || Number.isNaN(v)) {
        if (v === undefined || v === null) { if (types.includes('null')) return null; }
        errors.push(`${path} must be a number`);
        return v;
      }
      if (primary === 'integer') v = Math.trunc(v);
      if (schema.minimum !== undefined && v < schema.minimum) v = schema.minimum;
      if (schema.maximum !== undefined && v > schema.maximum) v = schema.maximum;
      return v;
    }
    case 'boolean': {
      let v = input;
      if (typeof v === 'string') v = v.toLowerCase() === 'true';
      if (typeof v !== 'boolean') { errors.push(`${path} must be a boolean`); return v; }
      return v;
    }
    default:
      return input;
  }
}

// Convenience: throw-style validation used where we want a hard failure.
export function assertValid(schema, input, label = 'input') {
  const { valid, errors, value } = validate(schema, input);
  if (!valid) {
    const err = new Error(`Invalid ${label}: ${errors.join('; ')}`);
    err.validationErrors = errors;
    throw err;
  }
  return value;
}

// ---- Shared schema for the planner's structured decision ------------------
// The LLM must return exactly one of: a tool call, or a final answer.
export const PLANNER_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    thought: { type: 'string', maxLength: 2000, default: '' },
    action: { type: 'string', enum: ['tool', 'final'] },
    tool: { type: ['string', 'null'], default: null },
    args: { type: 'object', additionalProperties: true, default: {} },
    message: { type: 'string', maxLength: 8000, default: '' },
  },
  required: ['action'],
};
