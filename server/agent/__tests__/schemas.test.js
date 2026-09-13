import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, PLANNER_DECISION_SCHEMA } from '../schemas.js';

test('validate: required fields flagged when missing', () => {
  const schema = { type: 'object', required: ['listId'], properties: { listId: { type: 'string' } } };
  const { valid, errors } = validate(schema, {});
  assert.equal(valid, false);
  assert.match(errors[0], /listId is required/);
});

test('validate: enum rejects out-of-set values', () => {
  const schema = { type: 'object', properties: { classification: { type: 'string', enum: ['safe', 'remove'] } } };
  const { valid } = validate(schema, { classification: 'nope' });
  assert.equal(valid, false);
});

test('validate: coerces numeric strings and clamps range', () => {
  const schema = { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } };
  const { valid, value } = validate(schema, { limit: '500' });
  assert.equal(valid, true);
  assert.equal(value.limit, 200);
});

test('validate: applies defaults', () => {
  const schema = { type: 'object', properties: { reverify: { type: 'boolean', default: false } } };
  const { value } = validate(schema, {});
  assert.equal(value.reverify, false);
});

test('planner decision schema accepts a tool action', () => {
  const { valid, value } = validate(PLANNER_DECISION_SCHEMA, { action: 'tool', tool: 'get_lists', args: {} });
  assert.equal(valid, true);
  assert.equal(value.action, 'tool');
});

test('planner decision schema rejects missing action', () => {
  const { valid } = validate(PLANNER_DECISION_SCHEMA, { message: 'hi' });
  assert.equal(valid, false);
});
