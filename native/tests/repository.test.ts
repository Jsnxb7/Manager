import { emptyCatalog, validateCatalog } from '../src/domain/catalog';
import {
  JsonRepository,
  RecoveryRequired,
} from '../src/repositories/JsonRepository';
import { migrateLegacy } from '../src/repositories/legacyImport';

function memory() {
  const files = new Map<string, string>();
  return {
    files,
    readText: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) {
        throw new Error('missing');
      }
      return v;
    },
    writeText: async (p: string, v: string) => {
      files.set(p, v);
    },
    exists: async (p: string) => files.has(p),
    mkdir: async () => {},
    removeOwned: async (p: string) => {
      files.delete(p);
    },
    replace: async (a: string, b: string) => {
      const v = files.get(a);
      if (v === undefined) {
        throw new Error('missing stage');
      }
      files.set(b, v);
      files.delete(a);
    },
  };
}
describe('JSON persistence and migration', () => {
  it('serializes simultaneous mutations without stale overwrite', async () => {
    const io = memory(),
      repo = new JsonRepository(io, 'app');
    await repo.load();
    await Promise.all([
      repo.mutate(c => {
        c.legacy.first = true;
      }),
      repo.mutate(c => {
        c.legacy.second = true;
      }),
    ]);
    expect((await new JsonRepository(io, 'app').load()).legacy).toEqual({
      first: true,
      second: true,
    });
  });
  it('refuses corrupt live data and restores only on an explicit request', async () => {
    const io = memory(),
      repo = new JsonRepository(io, 'app');
    await repo.load();
    await repo.mutate(c => {
      c.legacy.saved = true;
    });
    io.files.set('app/catalog.json', '{"truncated":');
    const reopened = new JsonRepository(io, 'app');
    await expect(reopened.load()).rejects.toBeInstanceOf(RecoveryRequired);
    expect(io.files.get('app/catalog.json')).toBe('{"truncated":');
    await reopened.restorePrevious();
    expect((await reopened.load()).schemaVersion).toBe(2);
  });
  it('retains the prior catalog if replacement fails and permits retry', async () => {
    const io = memory();
    const repo = new JsonRepository(io, 'app');
    const first = await repo.load();
    const original = io.replace;
    io.replace = async () => {
      throw new Error('disk full');
    };
    await expect(
      repo.mutate(c => {
        c.legacy.unsaved = true;
      }),
    ).rejects.toThrow('disk full');
    expect((await repo.load()).revision).toBe(first.revision);
    io.replace = original;
    await repo.mutate(c => {
      c.legacy.retry = true;
    });
    expect((await repo.load()).legacy.retry).toBe(true);
  });
  it('migrates watched state and links references while retaining unknown metadata', () => {
    const result = migrateLegacy(
      {
        'anime_data.json': [
          {
            id: 7,
            title: 'Sample',
            season: 'S1',
            watched: true,
            custom: 'kept',
            directory: 'D:/Media/Sample/S1',
            episodes: [
              {
                number: 3,
                watched: false,
                file_path: 'D:/Media/Sample/S1/EP.03.mkv',
              },
            ],
          },
        ],
        'queue.json': { queue: [{ id: 7 }, { id: 7 }, { id: 99 }] },
      },
      'fixture',
    );
    const entry = result.catalog.entries[0]!;
    expect(entry.episodes[0]?.relativeFile).toBe('EP.03.mkv');
    expect(entry.watched).toBe(true);
    expect(entry.legacy.custom).toBe('kept');
    expect(entry.legacy.directory).toBeUndefined();
    expect(result.catalog.queue).toEqual([entry.id]);
    expect(result.warnings).toHaveLength(1);
  });
  it('rejects duplicate identities and dangling references', () => {
    const value = emptyCatalog();
    value.queue = ['missing'];
    expect(() => validateCatalog(value)).toThrow('Orphan queue');
  });
});
