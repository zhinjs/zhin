import { MySQL } from '../src/dialects/mysql.js';

describe('MySQL schema generation', () => {
  const db = new MySQL({});

  it('uses expression defaults for TEXT and JSON while preserving scalar defaults', () => {
    const { query } = db.buildQuery({ type: 'create', tableName: 'defaults', definition: {
      message_key: { type: 'text', default: '' },
      label: { type: 'text', default: "o'clock" },
      metadata: { type: 'json', default: { tags: [] } },
      optional: { type: 'text', default: null },
      count: { type: 'integer', default: 0 },
    } });
    expect(query).toContain("`message_key` TEXT DEFAULT ('')");
    expect(query).toContain("`label` TEXT DEFAULT ('o''clock')");
    expect(query).toContain('`metadata` JSON DEFAULT (\'{"tags":[]}\')');
    expect(query).toContain('`optional` TEXT DEFAULT NULL');
    expect(query).toContain('`count` INT DEFAULT 0');
  });

  it('uses fully indexed VARCHAR columns for text keys, without prefix uniqueness', () => {
    const { query } = db.buildQuery({ type: 'create', tableName: 'keys', definition: {
      event_id: { type: 'text', unique: true, nullable: false },
      id: { type: 'text', primary: true, length: 64 },
      label: { type: 'text', length: 120, default: '' },
      payload: { type: 'text' },
    } });
    expect(query).toContain('`event_id` VARCHAR(768) UNIQUE NOT NULL');
    expect(query).toContain('`id` VARCHAR(64) PRIMARY KEY');
    expect(query).toContain("`label` VARCHAR(120) DEFAULT ''");
    expect(query).toContain('`payload` TEXT');
  });
});
