export type FileEntry = {
  name: string;
  uri: string;
  directory: boolean;
  size: number;
};
export interface StorageAdapter {
  readonly privateRoot: string;
  readonly initialMedia: string | null;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  readBytes(uri: string): Promise<Uint8Array>;
  writeBytes(uri: string, bytes: Uint8Array): Promise<void>;
  exists(uri: string): Promise<boolean>;
  list(uri: string): Promise<FileEntry[]>;
  mkdir(uri: string): Promise<void>;
  replace(staged: string, destination: string): Promise<void>;
  removeOwned(uri: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  pickFiles(
    kind: 'video' | 'image' | 'subtitle' | 'catalog',
  ): Promise<string[]>;
  saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
  resolveChild(root: string, relativePath: string): Promise<string | null>;
  createMediaFolder(root: string, relativePath: string): Promise<string>;
  deleteMediaFolder(root: string, relativePath: string): Promise<void>;
  thumbnail(source: string, destination: string, width: number): Promise<void>;
  reveal(uri: string): Promise<void>;
}
export type PlayerTracks = {
  audio: { id: string; label: string }[];
  subtitles: { id: string; label: string }[];
};
export interface PlayerHandle {
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  fullscreen(enabled: boolean): void;
}
export type PlatformCapabilities = {
  folderAccess: boolean;
  video: boolean;
  webp: boolean;
  pictureInPicture: boolean;
  reveal: boolean;
};
