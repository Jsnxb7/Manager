"""Resolve saved anime paths beneath the configured series library."""
import ntpath
import os


def relative_parts(value):
    normalized = ntpath.normpath(value)
    if ntpath.isabs(normalized) or ntpath.splitdrive(normalized)[0]:
        raise ValueError("Library paths must be relative to the anime folder.")
    parts = normalized.replace("\\", "/").split("/")
    if ".." in parts:
        raise ValueError("Library paths cannot leave the anime folder.")
    return [part for part in parts if part not in ("", ".")]


def resolve_anime_paths(anime, root):
    old_directory = anime.get("directory") or anime.get("folder_path") or anime.get("path") or ""
    relative = anime.get("library_relative_directory")
    if not relative:
        if old_directory:
            # Legacy records use <library>/<series folder>/<season folder>.
            # Keep the actual folder names, even if the display title changed.
            relative = "/".join(old_directory.replace("\\", "/").rstrip("/").split("/")[-2:])
        else:
            relative = f'{anime.get("title", "")}/{anime.get("season", "S1")}'
    parts = relative_parts(relative)
    if not parts:
        raise ValueError("An anime must have a folder within the library.")
    directory = os.path.join(root, *parts)
    anime["library_relative_directory"] = "/".join(parts)
    anime["directory"] = directory
    for alias in ("folder_path", "path"):
        if alias in anime:
            anime[alias] = directory
    for episode in anime.get("episodes", []):
        old_file = episode.get("file_path") or ""
        filename = ntpath.basename(old_file) or f'{episode.get("number", 1)}.mp4'
        if old_directory and old_file:
            try:
                filename = "/".join(relative_parts(ntpath.relpath(old_file, old_directory))) or filename
            except ValueError:
                pass
        episode["file_path"] = os.path.join(directory, *relative_parts(filename)).replace("\\", "/")
        if "directory" in episode:
            episode["directory"] = directory
    return anime
