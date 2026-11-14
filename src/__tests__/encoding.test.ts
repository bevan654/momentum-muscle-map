import { describe, expect, it } from 'vitest';
// @ts-expect-error the generator is a plain script with no type declarations
import { decodeRel, encodeRel, parsePath } from '../../scripts/gen-data.mjs';

describe('relative path encoding', () => {
  it('decodes to exactly the coordinates it was given', () => {
    const d = 'M399.4 298.5L399.5 296.8L400.5 296.8L400.5 300.0C401.0 300.5 402.5 301.0 399.0 310.2L0.5 -0.4ZM10.0 10.0L20.0 10.0L20.0 20.0Z';
    const subs = parsePath(d);
    expect(subs).toHaveLength(2);
    for (const sub of subs) expect(decodeRel(encodeRel(sub))).toEqual(sub);
  });

  it('writes the shortest form', () => {
    const [sub] = parsePath('M10.0 10.0L20.5 10.0L20.5 9.5L21.0 9.0L20.0 8.5Z');
    expect(encodeRel(sub)).toBe('M10 10h10.5v-.5l.5-.5-1-.5z');
  });
});
