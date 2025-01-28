document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.querySelector("input[type='text']");
    const sortSelect = document.querySelector("select");

    // Assuming the anime data is already available in the animeData variable (which is passed by Flask)
    const animeData = window.animeData || [];

    // Render anime data dynamically
    function renderAnime(animeList) {
        const container = document.querySelector("section.grid");
        container.innerHTML = '';  // Clear previous content

        animeList.forEach(anime => {
            const animeCard = document.createElement('div');
            animeCard.classList.add('bg-gray-800', 'rounded-lg', 'shadow-lg', 'overflow-hidden');

            const animeContent = `
                <img src="${anime.image_url}" alt="Anime Cover" class="w-full h-48 object-cover">
                <div class="p-4">
                    <h3 class="text-lg font-bold">${anime.title}</h3>
                    <p class="text-sm text-gray-400">${anime.description}</p>
                    <ul class="mt-4 space-y-2 text-gray-300">
                        ${anime.episodes.map(episode => `
                            <li>
                                <span class="font-semibold">Episode ${episode.number}:</span>
                                ${episode.title} 
                                ${episode.watched ? '<span class="text-green-400">(Watched)</span>' : '<span class="text-red-400">(Not Watched)</span>'}
                            </li>
                        `).join('')}
                    </ul>
                    <div class="flex justify-between items-center mt-4">
                        <button class="px-3 py-1 bg-pink-500 rounded-lg text-sm hover:bg-pink-600">Bookmark</button>
                        <a href="{{ url_for('anime_details', anime_id=anime.id) }}" class="text-sm text-pink-400 hover:underline">View Details</a>
                    </div>
                </div>
            `;
            animeCard.innerHTML = animeContent;
            container.appendChild(animeCard);
        });
    }

    // Initial render of anime
    renderAnime(animeData);

    // Search anime
    searchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filteredAnime = animeData.filter(anime => anime.title.toLowerCase().includes(query));
        renderAnime(filteredAnime);
    });

    // Sort anime
    sortSelect.addEventListener("change", (e) => {
        const sortBy = e.target.value;
        let sortedAnime = [...animeData];

        if (sortBy === "popularity") {
            // Example logic for sorting by popularity
            sortedAnime = sortedAnime.sort(() => Math.random() - 0.5); // Random order for demo purposes
        } else if (sortBy === "release-date") {
            // Implement sorting by release date (if applicable)
            sortedAnime = sortedAnime.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
        } else if (sortBy === "rating") {
            // Implement sorting by rating (if applicable)
            sortedAnime = sortedAnime.sort((a, b) => b.rating - a.rating);
        }

        renderAnime(sortedAnime);
    });
});
