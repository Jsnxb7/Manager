export type Route =
  | { name: 'home' }
  | { name: 'library'; sectionId: string }
  | { name: 'add'; sectionId: string }
  | { name: 'details'; animeId: string; tab?: 'details' | 'relations' }
  | {
      name: 'player';
      animeId: string;
      episodeId: string;
      resume: boolean;
      queueAnchor?: string;
    }
  | { name: 'queue' }
  | { name: 'custom'; initialUri?: string }
  | { name: 'settings' };
