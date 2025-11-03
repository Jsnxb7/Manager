import json

# Load JSON from a file
with open("data/anime_data.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Update download links
for entry in data:
    if "download_link" in entry:
        entry["download_link"] = entry["download_link"].replace(".ru", ".si")

# Save back to file
with open("data/anime_data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4, ensure_ascii=False)

print("Download links updated successfully!")
