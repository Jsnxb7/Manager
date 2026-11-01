import { EntryDraft } from '../services/library';
import { normalizeStatus } from '../repositories/legacyImport';
export type SearchResult = {
  mal_id: number;
  title: string;
  type: string;
  status: string;
  episodes: number | null;
  images?: { webp?: { image_url?: string }; jpg?: { image_url?: string } };
  url: string;
  genres?: { name: string }[];
  themes?: { name: string }[];
  demographics?: { name: string }[];
};
export class JikanClient {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private inFlight = new Map<string, Promise<unknown>>();
  private tail: Promise<void> = Promise.resolve();
  private lastRequest = 0;
  private request<T>(path: string, signal: AbortSignal): Promise<T> {
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) {
      return Promise.resolve(cached.value as T);
    }
    const current = this.inFlight.get(path);
    if (current) {
      return current as Promise<T>;
    }
    const task = this.tail.then(async () => {
      if (signal.aborted) {
        throw new Error('Search cancelled');
      }
      const wait = Math.max(0, 400 - (Date.now() - this.lastRequest));
      if (wait) {
        await new Promise<void>(resolve => setTimeout(resolve, wait));
      }
      if (signal.aborted) {
        throw new Error('Search cancelled');
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        this.lastRequest = Date.now();
        const response = await fetch(`https://api.jikan.moe/v4/${path}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(
            response.status === 429
              ? `Metadata search rate limit. Retry after ${
                  response.headers.get('Retry-After') ?? 'a few'
                } seconds.`
              : 'Metadata search unavailable. You can enter the title manually.',
          );
        }
        const value: unknown = await response.json();
        this.cache.set(path, { value, expires: Date.now() + 600000 });
        if (this.cache.size > 128) {
          this.cache.delete(this.cache.keys().next().value!);
        }
        return value as T;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
    });
    this.tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight.set(path, task);
    task.then(
      () => this.inFlight.delete(path),
      () => this.inFlight.delete(path),
    );
    return task;
  }
  async search(
    kind: 'anime' | 'manga',
    query: string,
    signal: AbortSignal,
  ): Promise<SearchResult[]> {
    if (query.trim().length < 2) {
      return [];
    }
    return (
      await this.request<{ data: SearchResult[] }>(
        `${kind}?q=${encodeURIComponent(query.trim())}&limit=8`,
        signal,
      )
    ).data;
  }
  async detail(
    kind: 'anime' | 'manga',
    id: number,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    return (await this.request<{ data: SearchResult }>(`${kind}/${id}`, signal))
      .data;
  }
}
export const jikan = new JikanClient();
export function mapJikan(
  item: SearchResult,
  kind: 'anime' | 'manga',
): Partial<EntryDraft> {
  const season =
    /\b(?:season|part)\s*(\d+)/i.exec(item.title)?.[1] ??
    /\b(\d+)(?:st|nd|rd|th)\s+season/i.exec(item.title)?.[1];
  const values = (group: { name: string }[] | undefined) =>
    group?.map(v => v.name) ?? [];
  return {
    title: item.title,
    season:
      kind === 'anime'
        ? ['Movie', 'OVA', 'Special'].includes(item.type)
          ? item.type
          : `S${season ?? 1}`
        : '',
    status: normalizeStatus(
      item.status.toLowerCase().includes('finished')
        ? 'Completed'
        : item.status.toLowerCase().includes('not yet')
        ? 'Not_Aired'
        : item.status,
      kind === 'anime',
    ),
    episodeCount: item.episodes ?? 1,
    link: item.url,
    metadata: {
      genres: values(item.genres),
      themes: values(item.themes),
      demographics: values(item.demographics),
      tags: [],
    },
    external: {
      provider: 'jikan',
      malId: item.mal_id,
      url: item.url,
      fetchedAt: new Date().toISOString(),
    },
  };
}
