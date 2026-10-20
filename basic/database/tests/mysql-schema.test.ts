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

  it.each([769, 1024])('rejects indexed text lengths exceeding the index limit: %s', length => {
    expect(() => db.buildQuery({ type: 'create', tableName: 'keys', definition: {
      id: { type: 'text', unique: true, length },
    } })).toThrow(/index limit/);
  });

  it.each([0, -1, 1.5, NaN])('rejects invalid bounded text lengths: %s', length => {
    expect(() => db.buildQuery({ type: 'create', tableName: 'keys', definition: {
      id: { type: 'text', length },
    } })).toThrow(/positive integer/);
  });

  it('allows non-indexed text longer than the index limit', () => {
    expect(db.buildQuery({ type: 'create', tableName: 'keys', definition: {
      label: { type: 'text', length: 1024 },
    } }).query).toContain('VARCHAR(1024)');
  });

  it.each([4096, 8192])('rejects unsupported index lengths before creating tables on %s-byte InnoDB pages', async pageSize => {
    const smallPages = new MySQL({}, { events: { event_id: { type: 'text', unique: true } } });
    vi.spyOn(smallPages.dialect, 'connect').mockResolvedValue();
    const query = vi.spyOn(smallPages.dialect, 'query').mockResolvedValue([{ page_size: pageSize }]);
    await expect(smallPages.start()).rejects.toThrow(/innodb_page_size=.*declare a smaller key length/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('uses fully indexed VARCHAR columns for text keys, without prefix uniqueness', () => {
    const { query } = db.buildQuery({ type: 'create', tableName: 'keys', definition: {
      event_id: { type: 'text', unique: true, nullable: false },
      id: { type: 'text', primary: true, length: 64 },
      label: { type: 'text', length: 120, default: '' },
      payload: { type: 'text' },
    } });
    expect(query).toContain('`event_id` VARCHAR(768) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin UNIQUE NOT NULL');
    expect(query).toContain('`id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin PRIMARY KEY');
    expect(query).toContain("`label` VARCHAR(120) DEFAULT ''");
    expect(query).toContain('`payload` TEXT');
    expect(query).toContain('ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
  });
});
