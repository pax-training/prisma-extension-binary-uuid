import { describe, expect, test } from 'vitest';

import { defineBinaryUuidConfig, normalizeConfig } from '../../src/config/define-config.js';
import { InvalidConfigError } from '../../src/errors.js';

describe('defineBinaryUuidConfig', () => {
  test('identity at runtime', () => {
    const input = { fields: { User: ['id'] } };
    expect(defineBinaryUuidConfig(input)).toBe(input);
  });
});

describe('normalizeConfig', () => {
  test('minimal valid config', () => {
    const n = normalizeConfig({ fields: { User: ['id'] } });
    expect(n.fields.get('User')?.has('id')).toBe(true);
    expect(n.autoGenerate.get('User')?.has('id')).toBe(true);
    expect(n.strictValidation).toBe(true);
    expect(n.allowBufferInput).toBe(true);
  });

  test('defaults autoGenerate to id-fields', () => {
    const n = normalizeConfig({ fields: { User: ['id', 'companyId'] } });
    expect(n.autoGenerate.get('User')?.has('id')).toBe(true);
    expect(n.autoGenerate.get('User')?.has('companyId')).toBe(false);
  });

  test('explicit autoGenerate overrides default', () => {
    const n = normalizeConfig({
      fields: { User: ['id', 'storageId'] },
      autoGenerate: { User: ['id', 'storageId'] },
    });
    expect(n.autoGenerate.get('User')?.has('id')).toBe(true);
    expect(n.autoGenerate.get('User')?.has('storageId')).toBe(true);
  });

  test('model with no id field → no autoGenerate entry by default', () => {
    const n = normalizeConfig({ fields: { Widget: ['widgetId'] } });
    expect(n.autoGenerate.get('Widget')).toBeUndefined();
  });

  test('relations preserved', () => {
    const n = normalizeConfig({
      fields: { User: ['id'], Post: ['id'] },
      relations: { User: { posts: 'Post' }, Post: { author: 'User' } },
    });
    expect(n.relations.get('User')?.get('posts')).toBe('Post');
    expect(n.relations.get('Post')?.get('author')).toBe('User');
  });

  test('options flags surface', () => {
    const n = normalizeConfig({
      fields: { User: ['id'] },
      options: { strictValidation: false, allowBufferInput: false },
    });
    expect(n.strictValidation).toBe(false);
    expect(n.allowBufferInput).toBe(false);
  });

  test('custom generator wired through', () => {
    const gen = () => new Uint8Array(16).fill(0x42);
    const n = normalizeConfig({ fields: { User: ['id'] }, generate: gen });
    expect(n.generate).toBe(gen);
  });

  test('v7 version selects v7 generator', () => {
    const n = normalizeConfig({ fields: { User: ['id'] }, version: 'v7' });
    const bin = n.generate();
    expect(bin[6]! & 0xf0).toBe(0x70);
  });

  test('allUuidFieldNames is the union across models', () => {
    const n = normalizeConfig({
      fields: { User: ['id', 'companyId'], Post: ['id', 'authorId'] },
    });
    expect(n.allUuidFieldNames.has('id')).toBe(true);
    expect(n.allUuidFieldNames.has('companyId')).toBe(true);
    expect(n.allUuidFieldNames.has('authorId')).toBe(true);
    expect(n.allUuidFieldNames.has('unknown')).toBe(false);
  });
});

describe('normalizeConfig validation', () => {
  test('rejects non-object', () => {
    expect(() => normalizeConfig(null as unknown as Parameters<typeof normalizeConfig>[0])).toThrow(
      InvalidConfigError,
    );
  });

  test('rejects missing fields', () => {
    expect(() =>
      normalizeConfig({} as unknown as Parameters<typeof normalizeConfig>[0]),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-array field list', () => {
    expect(() =>
      normalizeConfig({ fields: { User: 'id' as unknown as string[] } }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects empty field list', () => {
    expect(() => normalizeConfig({ fields: { User: [] } })).toThrow(InvalidConfigError);
  });

  test('rejects duplicate field name', () => {
    expect(() => normalizeConfig({ fields: { User: ['id', 'id'] } })).toThrow(InvalidConfigError);
  });

  test('rejects non-string field', () => {
    expect(() =>
      normalizeConfig({ fields: { User: [42 as unknown as string] } }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects empty-string field', () => {
    expect(() => normalizeConfig({ fields: { User: [''] } })).toThrow(InvalidConfigError);
  });

  test('rejects autoGenerate for unknown model', () => {
    expect(() =>
      normalizeConfig({ fields: { User: ['id'] }, autoGenerate: { Ghost: ['id'] } }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects autoGenerate field not in fields', () => {
    expect(() =>
      normalizeConfig({ fields: { User: ['id'] }, autoGenerate: { User: ['foo'] } }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-function generate', () => {
    expect(() =>
      normalizeConfig({
        fields: { User: ['id'] },
        generate: 'nope' as unknown as () => Uint8Array,
      }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-object relations', () => {
    expect(() =>
      normalizeConfig({
        fields: { User: ['id'] },
        relations: 'nope' as unknown as Record<string, Record<string, string>>,
      }),
    ).toThrow(InvalidConfigError);
  });
});
