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
class RateLimitError extends Error {}
const decodeHtml = (value: string) =>
  value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (entity, code: string) => {
      if (code[0] === '#') {
        const point =
          code.charAt(1).toLowerCase() === 'x'
            ? parseInt(code.slice(2), 16)
            : Number(code.slice(1));
        return point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return (
        (
          {
            amp: '&',
            quot: '"',
            apos: "'",
            lt: '<',
            gt: '>',
            nbsp: ' ',
          } as Record<string, string>
        )[code.toLowerCase()] ?? entity
      );
    },
  );
const plainText = (html: string) =>
  decodeHtml(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
function malDetail(
  html: string,
  kind: 'anime' | 'manga',
  id: number,
  suggestion?: SearchResult,
): SearchResult {
  const meta = (name: string) => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const attributes: Record<string, string> = {};
      for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
        attributes[match[1]!.toLowerCase()] = decodeHtml(match[3] ?? '').trim();
      }
      if ((attributes.property ?? attributes.name) === name) {
        return attributes.content ?? '';
      }
    }
    return '';
  };
  const fragment = (label: string) =>
    new RegExp(
      `<span[^>]*class=["'][^"']*dark_text[^"']*["'][^>]*>\\s*${label}:\\s*</span>([\\s\\S]*?)(?=<br\\s*/?>|</div>)`,
      'i',
    ).exec(html)?.[1] ?? '';
  const field = (label: string) => plainText(fragment(label));
  const names = (plural: string, singular: string) => {
    const part = fragment(plural) || fragment(singular);
    const links = [...part.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(m =>
      plainText(m[1] ?? ''),
    );
    return [
      ...new Set(
        links.length
          ? links
          : plainText(part)
              .split(',')
              .map(v => v.trim()),
      ),
    ]
      .filter(v => v && v.toLowerCase() !== 'none found')
      .map(name => ({ name }));
  };
  return {
    mal_id: id,
    title: meta('og:title') || suggestion?.title || 'Untitled',
    type: field('Type') || suggestion?.type || '',
    status: field('Status') || suggestion?.status || '',
    episodes:
      kind === 'anime'
        ? Number(/\d+/.exec(field('Episodes'))?.[0]) || null
        : null,
    images: {
      jpg: {
        image_url: meta('og:image') || suggestion?.images?.jpg?.image_url || '',
      },
    },
    url:
      meta('og:url') ||
      suggestion?.url ||
      `https://myanimelist.net/${kind}/${id}`,
    genres: names('Genres', 'Genre'),
    themes: names('Themes', 'Theme'),
    demographics: names('Demographics', 'Demographic'),
  };
}
export class JikanClient {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private inFlight = new Map<string, Promise<unknown>>();
  private tail: Promise<void> = Promise.resolve();
  private lastRequest = 0;
  private suggestions = new Map<string, SearchResult>();
  private request<T>(
    path: string,
    signal: AbortSignal,
    text = false,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(new Error('Search cancelled'));
    }
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
        const response = await fetch(
          path.startsWith('https://')
            ? path
            : `https://api.jikan.moe/v4/${path}`,
          {
            signal: controller.signal,
            headers: {
              Accept: text
                ? 'text/html,application/xhtml+xml'
                : 'application/json',
            },
          },
        );
        if (!response.ok) {
          const ErrorType = response.status === 429 ? RateLimitError : Error;
          throw new ErrorType(
            response.status === 429
              ? `Metadata search rate limit. Retry after ${
                  response.headers.get('Retry-After') ?? 'a few'
                } seconds.`
              : 'Metadata search unavailable. You can enter the title manually.',
          );
        }
        const value: unknown = text
          ? await response.text()
          : await response.json();
        if (signal.aborted) {
          throw new Error('Search cancelled');
        }
        this.cache.set(path, {
          value,
          expires: Date.now() + (text ? 3600000 : 600000),
        });
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
    try {
      const result = await this.request<{ data?: SearchResult[] }>(
        `${kind}?q=${encodeURIComponent(query.trim())}&limit=8&sfw=true`,
        signal,
      );
      if (Array.isArray(result?.data) && result.data.length) {
        return result.data;
      }
    } catch (error) {
      if (signal.aborted || error instanceof RateLimitError) {
        throw error;
      }
    }
    const payload = await this.request<{
      categories?: {
        type: string;
        items?: {
          id: number;
          name?: string;
          url?: string;
          image_url?: string;
          thumbnail_url?: string;
          payload?: { media_type?: string; status?: string };
        }[];
      }[];
    }>(
      `https://myanimelist.net/search/prefix.json?type=${kind}&keyword=${encodeURIComponent(
        query.trim(),
      )}&v=1`,
      signal,
    );
    if (!Array.isArray(payload?.categories)) {
      throw new Error('Metadata search returned an invalid response.');
    }
    const results = payload.categories
      .filter(c => c?.type === kind)
      .flatMap(c => (Array.isArray(c.items) ? c.items : []))
      .slice(0, 8)
      .filter(
        item =>
          item && Number.isInteger(Number(item.id)) && Number(item.id) > 0,
      )
      .map(item => ({
        mal_id: Number(item.id),
        title: item.name || 'Untitled',
        type: item.payload?.media_type || '',
        status: item.payload?.status || '',
        episodes: null,
        images: {
          jpg: { image_url: item.image_url || item.thumbnail_url || '' },
        },
        url: item.url || `https://myanimelist.net/${kind}/${item.id}`,
      }));
    for (const item of results) {
      this.suggestions.set(`${kind}/${item.mal_id}`, item);
      if (this.suggestions.size > 128) {
        this.suggestions.delete(this.suggestions.keys().next().value!);
      }
    }
    return results;
  }
  async detail(
    kind: 'anime' | 'manga',
    id: number,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    let failure: unknown = new Error('Jikan did not return this title.');
    try {
      const result = await this.request<{ data?: SearchResult }>(
        `${kind}/${id}`,
        signal,
      );
      if (
        result?.data &&
        !Array.isArray(result.data) &&
        Number(result.data.mal_id) === id &&
        typeof result.data.title === 'string' &&
        result.data.title.trim()
      ) {
        return result.data;
      }
    } catch (error) {
      if (signal.aborted || error instanceof RateLimitError) {
        throw error;
      }
      failure = error;
    }
    const suggestion = this.suggestions.get(`${kind}/${id}`);
    // Use the known MAL origin even if a suggestion contains an unexpected URL.
    const url = suggestion?.url?.startsWith(
      `https://myanimelist.net/${kind}/${id}/`,
    )
      ? suggestion.url
      : `https://myanimelist.net/${kind}/${id}`;
    try {
      return malDetail(
        await this.request<string>(url, signal, true),
        kind,
        id,
        suggestion,
      );
    } catch (error) {
      if (signal.aborted || error instanceof RateLimitError) {
        throw error;
      }
      if (suggestion) {
        return { ...suggestion, genres: [], themes: [], demographics: [] };
      }
      throw failure;
    }
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
