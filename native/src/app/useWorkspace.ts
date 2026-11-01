import { useCallback, useEffect, useRef, useState } from 'react';
import { Catalog, DeviceSettings, emptySettings } from '../domain/catalog';
import { StorageAdapter } from '../platform/contracts';
import { createNativeStorage } from '../platform/nativeStorage';
import { JsonRepository } from '../repositories/JsonRepository';
import { CatalogRegistry } from '../repositories/CatalogRegistry';
import { ImportPreview } from '../services/transfer';
export function useWorkspace() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [settings, setSettings] = useState<DeviceSettings>(emptySettings);
  const [io, setIo] = useState<StorageAdapter | null>(null);
  const [repo, setRepo] = useState<JsonRepository | null>(null);
  const [error, setShownError] = useState('');
  const logTo = useRef<StorageAdapter | null>(null);
  // Errors also go to a small log file so problems can be traced afterwards.
  const setError = useCallback((value: unknown) => {
    const message = value === '' ? '' : String(value);
    setShownError(message);
    const storage = logTo.current;
    if (message && storage) {
      const path = `${storage.privateRoot}/app-log.txt`;
      storage
        .exists(path)
        .then(found => (found ? storage.readText(path) : ''))
        .then(old =>
          storage.writeText(
            path,
            [
              ...old.split('\n').slice(-499),
              `${new Date().toISOString()} ${message}`,
            ].join('\n'),
          ),
        )
        .catch(() => undefined);
    }
  }, []);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const registry = useRef<CatalogRegistry | null>(null);
  const [savedCatalogs, setSavedCatalogs] = useState<
    { id: string; path: string }[]
  >([]);
  const live = useRef(true);
  const settingTail = useRef<Promise<void>>(Promise.resolve());
  const start = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      const storage = await createNativeStorage();
      logTo.current = storage;
      setIo(storage);
      const manager = new CatalogRegistry(storage);
      registry.current = manager;
      const opened = await manager.start();
      setIo(storage);
      setRepo(opened.repo);
      setSavedCatalogs(manager.catalogs);
      const local = opened.settings;
      if (live.current) {
        setCatalog(opened.catalog);
        setSettings(local);
      }
    } catch (e) {
      if (registry.current?.recoveryRepo) {
        setRepo(registry.current.recoveryRepo);
      }
      if (live.current) {
        setError(String(e));
      }
    } finally {
      if (live.current) {
        setBusy(false);
      }
    }
  }, [setError]);
  useEffect(() => {
    live.current = true;
    start().catch(e => setError(String(e)));
    return () => {
      live.current = false;
    };
  }, [start, setError]);
  const run = async (
    task: () => Promise<void>,
    message = 'Saved',
  ): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await task();
      setNotice(message);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (change: (draft: Catalog) => void): Promise<void> => {
    if (!repo) {
      throw new Error('Catalog is not ready');
    }
    setCatalog(await repo.mutate(change));
  };
  const updateSettings = (
    change: (draft: DeviceSettings) => void,
  ): Promise<void> => {
    if (!repo) {
      return Promise.reject(new Error('Catalog is not ready'));
    }
    const operation = settingTail.current.then(async () => {
      const draft = await repo.loadSettings();
      change(draft);
      await repo.saveSettings(draft);
      setSettings(draft);
    });
    settingTail.current = operation.catch(() => undefined);
    return operation;
  };
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const acceptImport = async (preview: ImportPreview): Promise<void> => {
    if (!repo || !registry.current) {
      throw new Error('Catalog is not ready');
    }
    const opened = await registry.current.accept(preview, repo, settings);
    setRepo(opened.repo);
    setCatalog(opened.catalog);
    setSettings(opened.settings);
    setSavedCatalogs(registry.current.catalogs);
  };
  const openSavedCatalog = async (path: string): Promise<void> => {
    if (!registry.current) {
      throw new Error('Catalog is not ready');
    }
    const opened = await registry.current.open(path);
    setRepo(opened.repo);
    setCatalog(opened.catalog);
    setSettings(opened.settings);
  };
  return {
    catalog,
    acceptImport,
    savedCatalogs,
    openSavedCatalog,
    setCatalog,
    settings,
    io,
    repo,
    error,
    setError,
    notice,
    busy,
    run,
    mutate,
    updateSettings,
    retry: start,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
