import {
  emptyCatalog,
  emptyFilter,
  emptyMetadata,
} from '../src/domain/catalog';
import { createEntry, filterEntries } from '../src/services/library';
describe('library validation and filtering', () => {
  it('combines groups with AND and values within a group with OR', () => {
    const c = emptyCatalog();
    const metadata = {
      ...emptyMetadata(),
      genres: ['Action'],
      tags: ['Dubbed'],
    };
    createEntry(c, 'anime', {
      title: 'Synthetic Show',
      season: 'S1',
      status: 'Ongoing',
      link: 'https://example.com',
      episodeCount: 2,
      metadata,
      cover: null,
      external: null,
    });
    const filter = emptyFilter();
    filter.metadata.genres = ['Drama', 'Action'];
    filter.metadata.tags = ['Dubbed'];
    expect(filterEntries(c.entries, filter)).toHaveLength(1);
    filter.metadata.tags = ['Subbed'];
    expect(filterEntries(c.entries, filter)).toHaveLength(0);
  });
  it('blocks duplicate manga titles regardless of release status', () => {
    const c = emptyCatalog();
    const draft = {
      title: 'Sample',
      season: '',
      status: 'Ongoing' as const,
      link: 'https://example.com',
      episodeCount: 0,
      metadata: { ...emptyMetadata(), tags: ['Sample'] },
      cover: null,
      external: null,
    };
    createEntry(c, 'manga', draft);
    expect(() =>
      createEntry(c, 'manga', { ...draft, status: 'Completed' }),
    ).toThrow('already exists');
  });
});
