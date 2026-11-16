import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { Catalog, DeviceSettings } from '../domain/catalog';
import { StorageAdapter } from '../platform/contracts';
import { JsonRepository } from './JsonRepository';
import { ImportPreview, applyImport } from '../services/transfer';
type Registry = { active: string; catalogs: { id: string; path: string }[] };
export type CatalogSummary = {
  id: string;
  path: string;
  active: boolean;
  titles: number | null;
  updatedAt: string;
};
export type OpenWorkspace = {
  repo: JsonRepository;
  catalog: Catalog;
  settings: DeviceSettings;
};
export class CatalogRegistry {
  recoveryRepo: JsonRepository | null = null;
  private value: Registry = { active: 'active', catalogs: [] };
  constructor(private readonly io: StorageAdapter) {}
  get catalogs(): Registry['catalogs'] {
    return [...this.value.catalogs];
  }
  private async persist(): Promise<void> {
    const root = this.io.privateRoot;
    await this.io.writeText(
      `${root}/catalog-index.staged.json`,
      JSON.stringify(this.value),
    );
    await this.io.replace(
      `${root}/catalog-index.staged.json`,
      `${root}/catalog-index.json`,
    );
  }
  async start(): Promise<OpenWorkspace> {
    const path = `${this.io.privateRoot}/catalog-index.json`;
    if (await this.io.exists(path)) {
      const raw = JSON.parse(await this.io.readText(path)) as Registry;
      if (
        !Array.isArray(raw.catalogs) ||
        !raw.catalogs.every(
          v =>
            typeof v.id === 'string' &&
            /^(active|library-[a-f0-9]{24})$/.test(v.path),
        ) ||
        !raw.catalogs.some(c => c.path === raw.active)
      ) {
        throw new Error(
          'Catalog index is invalid; restore its backup before opening.',
        );
      }
      this.value = raw;
    }
    return this.open(this.value.active);
  }
  async open(path: string): Promise<OpenWorkspace> {
    if (!/^(active|library-[a-f0-9]{24})$/.test(path)) {
      throw new Error('Invalid local catalog path');
    }
    const repo = new JsonRepository(this.io, `${this.io.privateRoot}/${path}`);
    this.recoveryRepo = repo;
    const catalog = await repo.load();
    const settings = await repo.loadSettings();
    if (!this.value.catalogs.some(c => c.path === path)) {
      this.value.catalogs.push({ id: catalog.id, path });
    }
    this.value.active = path;
    await this.persist();
    return { repo, catalog, settings };
  }
  /** Title count and last change for each saved catalog, for people to tell them apart. */
  async describe(): Promise<CatalogSummary[]> {
    const result: CatalogSummary[] = [];
    for (const saved of this.value.catalogs) {
      const summary: CatalogSummary = {
        ...saved,
        active: saved.path === this.value.active,
        titles: null,
        updatedAt: '',
      };
      try {
        const raw = JSON.parse(
          await this.io.readText(
            `${this.io.privateRoot}/${saved.path}/catalog.json`,
          ),
        ) as { entries?: unknown[]; updatedAt?: string };
        summary.titles = Array.isArray(raw.entries) ? raw.entries.length : 0;
        summary.updatedAt = raw.updatedAt ?? '';
      } catch {
        /* Shown as unreadable; never removable from here. */
      }
      result.push(summary);
    }
    return result;
  }
  /** Removes a saved catalog that holds no titles. The open one always stays. */
  async removeEmpty(path: string): Promise<void> {
    const [summary] = (await this.describe()).filter(c => c.path === path);
    if (!summary || summary.active || summary.titles !== 0) {
      throw new Error('Only an empty catalog that is not open can be removed.');
    }
    this.value.catalogs = this.value.catalogs.filter(c => c.path !== path);
    await this.persist();
    await this.io.removeOwned(`${this.io.privateRoot}/${path}`);
  }
  async accept(
    preview: ImportPreview,
    current: JsonRepository,
    currentSettings: DeviceSettings,
  ): Promise<OpenWorkspace> {
    const before = await current.snapshot();
    if (before.revision !== preview.expectedRevision) {
      throw new Error('Catalog changed; review the import again.');
    }
    if (before.id === preview.catalog.id) {
      const catalog = await applyImport(preview, current, this.io);
      return { repo: current, catalog, settings: await current.loadSettings() };
    }
    const key = `library-${bytesToHex(
      sha256(utf8ToBytes(preview.catalog.id)),
    ).slice(0, 24)}`;
    const target = new JsonRepository(this.io, `${this.io.privateRoot}/${key}`);
    const existing = await target.load();
    if (
      existing.id === preview.catalog.id &&
      existing.revision !== preview.catalog.revision
    ) {
      throw new Error(
        'This catalog is already saved on this device. Open it first, then review and import the updated snapshot there.',
      );
    }
    const catalog = await applyImport(
      { ...preview, expectedRevision: existing.revision },
      target,
      this.io,
    );
    if (
      !(await this.io.exists(
        `${this.io.privateRoot}/${key}/device-settings.json`,
      ))
    ) {
      await target.saveSettings({
        ...currentSettings,
        titleFolders: {},
        episodeFiles: {},
        filters: {},
      });
    }
    const old = this.value.catalogs.find(c => c.path === key);
    if (old) {
      old.id = catalog.id;
    } else {
      this.value.catalogs.push({ id: catalog.id, path: key });
    }
    this.value.active = key;
    await this.persist();
    return { repo: target, catalog, settings: await target.loadSettings() };
  }
}
