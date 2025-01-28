// bookmarksManager.js

document.addEventListener("DOMContentLoaded", () => {
    const removeButtons = document.querySelectorAll("button.bg-red-500");

    removeButtons.forEach(button => {
        button.addEventListener("click", (e) => {
            const listItem = e.target.closest("li");
            listItem.remove();
            alert("Bookmark removed!");
        });
    });
});
