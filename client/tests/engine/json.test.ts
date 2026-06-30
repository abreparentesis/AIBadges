import { describe, it, expect } from 'vitest';
import { parseJsonResponse } from '../../src/engine/json';

describe('parseJsonResponse', () => {
  it('parses a fenced json block', () => {
    expect(parseJsonResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('parses bare json', () => {
    expect(parseJsonResponse('[1,2,3]')).toEqual([1, 2, 3]);
  });
  it('parses json embedded in prose', () => {
    expect(parseJsonResponse('Here you go:\n{"a":2}\nHope that helps.')).toEqual({ a: 2 });
  });
  it('throws on non-json', () => {
    expect(() => parseJsonResponse('no json here')).toThrow();
  });
});
