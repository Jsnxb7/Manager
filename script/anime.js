// animeDetails.js

document.addEventListener("DOMContentLoaded", () => {
    const bookmarkButton = document.querySelector("button.bg-pink-500");
    const episodeButtons = document.querySelectorAll(".bg-pink-500, .bg-gray-500");
    const linkButtons = document.querySelectorAll("a");

    // Bookmark the anime
    bookmarkButton.addEventListener("click", () => {
        const isBookmarked = bookmarkButton.textContent.includes("Bookmarked");
        bookmarkButton.textContent = isBookmarked ? "Bookmark" : "Bookmarked";
        bookmarkButton.classList.toggle("bg-gray-500");
        bookmarkButton.classList.toggle("bg-pink-500");
        alert(isBookmarked ? "Removed from bookmarks" : "Added to bookmarks");
    });

    // Mark episodes as watched
    episodeButtons.forEach(button => {
        button.addEventListener("click", (e) => {
            const isWatched = button.classList.contains("bg-gray-500");
            if (!isWatched) {
                button.textContent = "Watched";
                button.classList.remove("bg-pink-500");
                button.classList.add("bg-gray-500");
                button.classList.add("cursor-not-allowed");
            }
        });
    });

    // Watch and Download links
    linkButtons.forEach(link => {
        link.addEventListener("click", (e) => {
            const type = link.classList.contains("bg-green-500") ? "Watch" : "Download";
            alert(`${type} link clicked for ${link.closest("li").querySelector("span").textContent}`);
        });
    });
});
