import requests
from bs4 import BeautifulSoup
import time
import random

def fetch_all_links(url):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/115.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.google.com/",
        "DNT": "1",  # Do Not Track
    }

    for attempt in range(5):  # up to 5 retries
        try:
            time.sleep(random.uniform(1, 3))  # random delay to look human
            resp = requests.get(url, headers=headers, timeout=15)
            resp.raise_for_status()  # raise error if HTTP status != 200
            soup = BeautifulSoup(resp.text, "lxml")

            links = [a["href"] for a in soup.find_all("a", href=True)]
            return links

        except requests.RequestException as e:
            print(f"Attempt {attempt+1} failed: {e}")
            if attempt == 4:
                return []  # failed after 5 tries

    return []


# Example usage
if __name__ == "__main__":
    url = "https://animepahe.ru/anime/f82612ed-8619-f0d9-f924-578abd40d4f5"
    all_links = fetch_all_links(url)
    print(f"Found {len(all_links)} links:")
    for link in all_links:
        print(link)
