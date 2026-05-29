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

const WINDOWS_RESERVED_NAMES = new Set([
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
]);

function securePathTitle(title) {
    let cleaned = (title || "").trim().replace(/[<>:"/\\|?*\x00]/g, "-");
    cleaned = cleaned.replace(/\s+/g, " ").replace(/[ .]+$/g, "");

    if (WINDOWS_RESERVED_NAMES.has(cleaned.toLowerCase())) {
        cleaned = `${cleaned}_`;
    }

    return cleaned;
}

function setFeedback(element, message, state) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.remove("is-good", "is-warn", "is-error");
    if (state) {
        element.classList.add(state);
    }
}

function previewThumbnail(input) {
    const form = input.closest("form");
    const img = form?.querySelector("#thumbnail-preview-img");
    const label = form?.querySelector("#thumbnail-preview-label");
    const file = input.files && input.files[0];

    if (!img || !label) return;

    if (!file) {
        img.removeAttribute("src");
        img.classList.remove("is-visible");
        label.textContent = "No image selected";
        return;
    }

    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    img.classList.add("is-visible");
    label.textContent = file.name;
}

function getValidationParams(form) {
    const params = new URLSearchParams();
    params.set("type", form.dataset.entryType || "");
    params.set("section", form.dataset.section || "");
    params.set("title", form.querySelector("[name='title']")?.value || "");
    params.set("season", form.querySelector("[name='season']")?.value || "");
    params.set("status", form.querySelector("[name='status']")?.value || "");
    params.set("link", form.querySelector("[name='link']")?.value || "");
    return params;
}

function setupValidatedAddForm(form) {
    const titleInput = form.querySelector("[name='title']");
    const submitButton = form.querySelector("[type='submit']");
    const titleFeedback = form.querySelector("#titleSafety");
    const duplicateFeedback = form.querySelector("#duplicateFeedback");
    const thumbnailInput = form.querySelector("[name='thumbnail']");
    let validationTimer = null;
    let activeRequest = null;

    function updateLocalTitleState() {
        const title = titleInput?.value.trim() || "";
        const safeTitle = securePathTitle(title);

        if (!title) {
            setFeedback(titleFeedback, "", "");
            return false;
        }

        if (!safeTitle) {
            setFeedback(titleFeedback, "Title cannot be used as an image filename.", "is-error");
            return false;
        }

        if (safeTitle === title) {
            setFeedback(titleFeedback, `Filename: ${safeTitle}`, "is-good");
        } else {
            setFeedback(titleFeedback, `Safe filename will be: ${safeTitle}`, "is-warn");
        }

        return true;
    }

    async function validateForm() {
        const hasSafeTitle = updateLocalTitleState();

        if (!hasSafeTitle) {
            submitButton.disabled = true;
            setFeedback(duplicateFeedback, "", "");
            return;
        }

        if (activeRequest) {
            activeRequest.abort();
        }

        activeRequest = new AbortController();

        try {
            const response = await fetch(`/api/validate-entry?${getValidationParams(form).toString()}`, {
                signal: activeRequest.signal
            });
            const data = await response.json();

            if (!response.ok) {
                submitButton.disabled = true;
                setFeedback(duplicateFeedback, "Could not validate this entry yet.", "is-error");
                return;
            }

            submitButton.disabled = !data.can_submit;
            setFeedback(
                duplicateFeedback,
                data.duplicate_message,
                data.exact_duplicate ? "is-error" : (data.same_title_count ? "is-warn" : "is-good")
            );

            if (data.safe_title && data.safe_title !== titleInput.value.trim()) {
                setFeedback(titleFeedback, `Safe filename will be: ${data.safe_title}`, "is-warn");
            }
        } catch (error) {
            if (error.name !== "AbortError") {
                submitButton.disabled = true;
                setFeedback(duplicateFeedback, "Validation failed. Try again in a moment.", "is-error");
            }
        }
    }

    function scheduleValidation() {
        window.clearTimeout(validationTimer);
        validationTimer = window.setTimeout(validateForm, 180);
    }

    form.querySelectorAll("[data-validate-field]").forEach((field) => {
        field.addEventListener("input", scheduleValidation);
        field.addEventListener("change", scheduleValidation);
    });

    thumbnailInput?.addEventListener("change", () => previewThumbnail(thumbnailInput));

    form.addEventListener("submit", (event) => {
        if (submitButton.disabled) {
            event.preventDefault();
        }
    });

    scheduleValidation();
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".validated-add-form").forEach(setupValidatedAddForm);
});
