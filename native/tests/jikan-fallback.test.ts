import { JikanClient, mapJikan } from '../src/integrations/JikanClient';

const json = (value: unknown) => ({ ok: true, json: async () => value });
const unavailable = () => ({
  ok: false,
  status: 502,
  headers: { get: () => null },
});
const suggestions = (kind = 'anime') => ({
  categories: [
    { type: 'other', items: [{ id: 999, name: 'Unrelated' }] },
    {
      type: kind,
      items: [
        {
          id: 123,
          name: 'Synthetic & Title',
          url: `https://myanimelist.net/${kind}/123/Synthetic`,
          thumbnail_url: 'https://cdn.myanimelist.net/synthetic.jpg',
          payload: {
            media_type: kind === 'anime' ? 'TV' : 'Manga',
            status: 'Currently Airing',
          },
        },
      ],
    },
  ],
});
const html = `<meta content="Synthetic &amp; Title" property="og:title">
<meta property='og:image' content='https://cdn.myanimelist.net/detail.jpg'>
<meta property="og:url" content="https://myanimelist.net/anime/123/Synthetic">
<span class="dark_text">Type:</span> TV<br>
<span class="dark_text">Status:</span> Finished Airing<br>
<span class="dark_text">Episodes:</span> 12<br>
<span class="dark_text">Genres:</span> <a>Action &amp; Adventure</a>, <a>Drama</a><br>
<span class="dark_text">Theme:</span> <a>School</a><br>
<span class="dark_text">Demographic:</span> Shounen<br>`;

describe('MAL metadata fallback', () => {
  const original = globalThis.fetch;
  let fetcher: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    fetcher = jest.fn();
    globalThis.fetch = fetcher;
  });
  afterEach(() => {
    globalThis.fetch = original;
    jest.useRealTimers();
  });
  async function finish<T>(promise: Promise<T>) {
    await jest.runAllTimersAsync();
    return promise;
  }
  it.each(['failed', 'empty', 'missing'])(
    'uses and caches suggestions for %s Jikan search',
    async reason => {
      fetcher
        .mockResolvedValueOnce(
          reason === 'failed'
            ? unavailable()
            : json(reason === 'empty' ? { data: [] } : {}),
        )
        .mockResolvedValueOnce(json(suggestions()))
        .mockResolvedValue(unavailable());
      const client = new JikanClient();
      const signal = new AbortController().signal;
      const [first, second] = await finish(
        Promise.all([
          client.search('anime', 'Synthetic & Title', signal),
          client.search('anime', 'Synthetic & Title', signal),
        ]),
      );
      expect(first).toEqual(second);
      expect(first[0]).toMatchObject({
        mal_id: 123,
        title: 'Synthetic & Title',
        type: 'TV',
        episodes: null,
        images: {
          jpg: { image_url: 'https://cdn.myanimelist.net/synthetic.jpg' },
        },
      });
      expect(fetcher.mock.calls[0][0]).toContain('&sfw=true');
      expect(fetcher.mock.calls[1][0]).toBe(
        'https://myanimelist.net/search/prefix.json?type=anime&keyword=Synthetic%20%26%20Title&v=1',
      );
      expect(
        await finish(client.search('anime', 'Synthetic & Title', signal)),
      ).toEqual(first);
      expect(fetcher).toHaveBeenCalledTimes(reason === 'failed' ? 3 : 2);
    },
  );
  it('falls back after a network error and limits suggestions to the requested kind and eight items', async () => {
    const category = suggestions('manga').categories[1]!;
    const payload = {
      categories: [
        {
          ...category,
          items: Array.from({ length: 10 }, (_, i) => ({
            ...category.items[0]!,
            id: i + 1,
          })),
        },
      ],
    };
    fetcher
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(json(payload));
    const results = await finish(
      new JikanClient().search(
        'manga',
        'Synthetic',
        new AbortController().signal,
      ),
    );
    expect(results).toHaveLength(8);
    expect(
      results.every(item => item.type === 'Manga' && item.episodes === null),
    ).toBe(true);
  });
  it.each([null, undefined, {}, []])(
    'normalizes MAL HTML when Jikan detail returns %s',
    async data => {
      fetcher
        .mockResolvedValueOnce(json({ data }))
        .mockResolvedValueOnce({ ok: true, text: async () => html });
      const detail = await finish(
        new JikanClient().detail('anime', 123, new AbortController().signal),
      );
      expect(detail).toMatchObject({
        mal_id: 123,
        title: 'Synthetic & Title',
        type: 'TV',
        status: 'Finished Airing',
        episodes: 12,
        genres: [{ name: 'Action & Adventure' }, { name: 'Drama' }],
        themes: [{ name: 'School' }],
        demographics: [{ name: 'Shounen' }],
      });
      expect(mapJikan(detail, 'anime')).toMatchObject({
        status: 'Completed',
        episodeCount: 12,
        metadata: { themes: ['School'] },
      });
      expect(fetcher.mock.calls[1][0]).toBe(
        'https://myanimelist.net/anime/123',
      );
    },
  );
  it('uses suggestion fields in a sparse MAL detail and caches HTML', async () => {
    fetcher
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(json(suggestions('manga')))
      .mockResolvedValueOnce(json({ data: null }))
      .mockResolvedValueOnce({ ok: true, text: async () => '<html></html>' });
    const client = new JikanClient();
    const signal = new AbortController().signal;
    const search = await finish(client.search('manga', 'Synthetic', signal));
    const detail = await finish(client.detail('manga', 123, signal));
    expect(detail).toMatchObject({
      ...search[0],
      genres: [],
      themes: [],
      demographics: [],
    });
    expect(await finish(client.detail('manga', 123, signal))).toEqual(detail);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('returns partial suggestion detail when both detail providers fail', async () => {
    fetcher
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(json(suggestions()))
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable());
    const client = new JikanClient();
    const signal = new AbortController().signal;
    const search = await finish(client.search('anime', 'Synthetic', signal));
    expect(await finish(client.detail('anime', 123, signal))).toEqual({
      ...search[0],
      genres: [],
      themes: [],
      demographics: [],
    });
  });
  it.each(['search', 'detail'] as const)(
    'preserves Jikan rate limits for %s even without Retry-After',
    async operation => {
      fetcher.mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: () => null },
      });
      const client = new JikanClient();
      const signal = new AbortController().signal;
      const promise =
        operation === 'search'
          ? client.search('anime', 'Synthetic', signal)
          : client.detail('anime', 123, signal);
      await Promise.all([
        expect(promise).rejects.toThrow('rate limit'),
        jest.runAllTimersAsync(),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves MAL rate limits', async () => {
    fetcher.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: () => '7' },
    });
    await Promise.all([
      expect(
        new JikanClient().search(
          'anime',
          'Synthetic',
          new AbortController().signal,
        ),
      ).rejects.toThrow('Retry after 7 seconds'),
      jest.runAllTimersAsync(),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not use fallback after an active request is aborted', async () => {
    fetcher.mockImplementation(
      (_url, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () =>
            reject(new Error('cancelled')),
          );
        }),
    );
    const abort = new AbortController();
    const promise = new JikanClient().search(
      'anime',
      'Synthetic',
      abort.signal,
    );
    await Promise.all([
      expect(promise).rejects.toThrow('cancelled'),
      (async () => {
        await Promise.resolve();
        abort.abort();
        await jest.runAllTimersAsync();
      })(),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('checks cancellation before cached responses and while waiting for fallback', async () => {
    fetcher.mockResolvedValue(json({ data: [{ mal_id: 123 }] }));
    const client = new JikanClient();
    const abort = new AbortController();
    await finish(client.search('anime', 'Synthetic', abort.signal));
    abort.abort();
    await expect(
      client.search('anime', 'Synthetic', abort.signal),
    ).rejects.toThrow('cancelled');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(unavailable());
    const next = new AbortController();
    const pending = client.search('anime', 'Another', next.signal);
    await Promise.all([
      expect(pending).rejects.toThrow('cancelled'),
      (async () => {
        next.abort();
        await jest.runAllTimersAsync();
      })(),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('spaces fallback requests through the same rate limiter', async () => {
    const times: number[] = [];
    fetcher.mockImplementation(() => {
      times.push(Date.now());
      return Promise.resolve(
        times.length === 1 ? unavailable() : json(suggestions()),
      );
    });
    await finish(
      new JikanClient().search(
        'anime',
        'Synthetic',
        new AbortController().signal,
      ),
    );
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(400);
  });
  it('does not substitute a suggestion for a rate-limited MAL detail', async () => {
    fetcher
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json(suggestions()))
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '9' },
      });
    const client = new JikanClient();
    const signal = new AbortController().signal;
    await finish(client.search('anime', 'Synthetic', signal));
    await Promise.all([
      expect(client.detail('anime', 123, signal)).rejects.toThrow(
        'Retry after 9 seconds',
      ),
      jest.runAllTimersAsync(),
    ]);
  });
  it.each(['search', 'detail'] as const)(
    'cancels an active MAL %s fallback',
    async operation => {
      fetcher.mockResolvedValueOnce(unavailable());
      const abort = new AbortController();
      fetcher.mockImplementation(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new Error('cancelled')),
            );
            abort.abort();
          }),
      );
      const client = new JikanClient();
      await Promise.all([
        expect(
          operation === 'search'
            ? client.search('anime', 'Synthetic', abort.signal)
            : client.detail('anime', 123, abort.signal),
        ).rejects.toThrow('cancelled'),
        jest.runAllTimersAsync(),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it('preserves the original Jikan detail error when neither provider has a result', async () => {
    fetcher
      .mockRejectedValueOnce(new Error('original Jikan failure'))
      .mockResolvedValueOnce(unavailable());
    await Promise.all([
      expect(
        new JikanClient().detail('anime', 123, new AbortController().signal),
      ).rejects.toThrow('original Jikan failure'),
      jest.runAllTimersAsync(),
    ]);
  });
});
