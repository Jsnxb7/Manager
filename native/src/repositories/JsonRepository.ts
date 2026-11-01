import {
  Catalog,
  DeviceSettings,
  cloneCatalog,
  emptyCatalog,
  emptySettings,
  newId,
  settingsSchema,
  validateCatalog,
} from '../domain/catalog';
import { StorageAdapter } from '../platform/contracts';

type JsonStorage = Pick<
  StorageAdapter,
  'readText' | 'writeText' | 'exists' | 'mkdir' | 'replace' | 'removeOwned'
>;
export class RecoveryRequired extends Error {
  constructor(readonly file: string, readonly original: unknown) {
    super(
      `Cannot read ${file}. Restore a verified backup or retry; existing data was not replaced.`,
    );
  }
}
export class JsonRepository {
  private tail: Promise<void> = Promise.resolve();
  private cached: Catalog | null = null;
  constructor(
    private readonly io: JsonStorage,
    private readonly root: string,
  ) {}
  private file(name: string): string {
    return `${this.root}/${name}`;
  }
  private async readCatalog(name: string): Promise<Catalog> {
    try {
      return validateCatalog(
        JSON.parse(await this.io.readText(this.file(name))),
      );
    } catch (error) {
      throw new RecoveryRequired(name, error);
    }
  }
  async load(): Promise<Catalog> {
    if (this.cached) {
      return cloneCatalog(this.cached);
    }
    const path = this.file('catalog.json');
    if (!(await this.io.exists(path))) {
      if (
        (await this.io.exists(this.file('catalog.journal.json'))) ||
        (await this.io.exists(this.file('catalog.previous.json')))
      ) {
        throw new RecoveryRequired(
          'catalog.json',
          'Interrupted write; backup retained',
        );
      }
      await this.io.mkdir(this.root);
      await this.commit(emptyCatalog(), null);
    }
    this.cached = await this.readCatalog('catalog.json');
    return cloneCatalog(this.cached);
  }
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async commit(next: Catalog, previous: Catalog | null): Promise<void> {
    const text = JSON.stringify(validateCatalog(next));
    await this.io.mkdir(this.root);
    if (previous) {
      await this.io.writeText(
        this.file('catalog.previous.json'),
        JSON.stringify(previous),
      );
    }
    await this.io.writeText(
      this.file('catalog.journal.json'),
      JSON.stringify({ from: previous?.revision ?? null, to: next.revision }),
    );
    await this.io.writeText(this.file('catalog.staged.json'), text);
    // Re-read before replace to catch truncated/failed writes without losing live data.
    await this.readCatalog('catalog.staged.json');
    await this.io.replace(
      this.file('catalog.staged.json'),
      this.file('catalog.json'),
    );
    this.cached = next;
    // A cleanup failure must not make a successful committed mutation appear failed.
    try {
      await this.io.removeOwned(this.file('catalog.journal.json'));
    } catch {
      /* Recoverable marker remains. */
    }
  }
  mutate(change: (draft: Catalog) => void): Promise<Catalog> {
    return this.serial(async () => {
      const previous = await this.load();
      const next = cloneCatalog(previous);
      change(next);
      next.parentRevision = previous.revision;
      next.revision = newId('revision');
      next.updatedAt = new Date().toISOString();
      await this.commit(next, previous);
      return cloneCatalog(next);
    });
  }
  replaceCatalog(
    candidate: Catalog,
    expectedRevision: string,
  ): Promise<Catalog> {
    return this.serial(async () => {
      const previous = await this.load();
      if (previous.revision !== expectedRevision) {
        throw new Error(
          'Catalog changed during import. Review the import again.',
        );
      }
      const next = validateCatalog(candidate);
      await this.commit(next, previous);
      return cloneCatalog(next);
    });
  }
  restorePrevious(): Promise<Catalog> {
    return this.serial(async () => {
      const backup = await this.readCatalog('catalog.previous.json');
      await this.commit(backup, null);
      return cloneCatalog(backup);
    });
  }
  async snapshot(): Promise<Catalog> {
    await this.tail;
    return this.load();
  }
  invalidate(): void {
    this.cached = null;
  }
  async loadSettings(): Promise<DeviceSettings> {
    const path = this.file('device-settings.json');
    if (!(await this.io.exists(path))) {
      return emptySettings();
    }
    try {
      return settingsSchema.parse(JSON.parse(await this.io.readText(path)));
    } catch (error) {
      throw new RecoveryRequired('device-settings.json', error);
    }
  }
  saveSettings(settings: DeviceSettings): Promise<void> {
    return this.serial(async () => {
      const text = JSON.stringify(settingsSchema.parse(settings));
      await this.io.mkdir(this.root);
      const staged = this.file('device-settings.staged.json');
      await this.io.writeText(staged, text);
      settingsSchema.parse(JSON.parse(await this.io.readText(staged)));
      await this.io.replace(staged, this.file('device-settings.json'));
    });
  }
}
