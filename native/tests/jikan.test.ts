import { JikanClient } from '../src/integrations/JikanClient';
describe('optional metadata requests', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  it('does not request metadata for an empty/short query', async () => {
    const fetcher = jest.fn();
    globalThis.fetch = fetcher;
    expect(
      await new JikanClient().search(
        'anime',
        'a',
        new AbortController().signal,
      ),
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates simultaneous requests and reuses the bounded cache', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ mal_id: 1, title: 'Sample' }] }),
    });
    globalThis.fetch = fetcher;
    const client = new JikanClient();
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([
      client.search('anime', 'sample', signal),
      client.search('anime', 'sample', signal),
    ]);
    expect(first).toEqual(second);
    await client.search('anime', 'sample', signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports rate limits without retrying indefinitely', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => '5' },
    });
    globalThis.fetch = fetcher;
    await expect(
      new JikanClient().search('anime', 'sample', new AbortController().signal),
    ).rejects.toThrow('Retry after 5 seconds');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not start an already-cancelled request', async () => {
    const fetcher = jest.fn();
    globalThis.fetch = fetcher;
    const abort = new AbortController();
    abort.abort();
    await expect(
      new JikanClient().search('anime', 'sample', abort.signal),
    ).rejects.toThrow('cancelled');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
