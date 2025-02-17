function toggleWatched(animeId, episodeNumber, button) {
    fetch(`/mark_watched/${animeId}/${episodeNumber}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            // Toggle the button text and class
            if (button.innerText === "Mark as Watched") {
                button.innerText = "✔ Watched";
                button.classList.add("watched");
            } else {
                button.innerText = "Mark as Watched";
                button.classList.remove("watched");
            }
        }
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}