function showToast(message, type = "success", duration = 3500) {
    const container = document.getElementById("toast-container");
    if (!container || !message) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Force layout so the transition below actually animates in.
    requestAnimationFrame(() => toast.classList.add("is-visible"));

    window.setTimeout(() => {
        toast.classList.remove("is-visible");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
        // Fallback removal in case transitionend doesn't fire.
        window.setTimeout(() => toast.remove(), 500);
    }, duration);
}

document.addEventListener("DOMContentLoaded", () => {
    let pendingToast = null;
    try {
        pendingToast = sessionStorage.getItem("pendingAddToast");
        if (pendingToast) {
            sessionStorage.removeItem("pendingAddToast");
        }
    } catch (error) {
        console.error("Could not read pending toast message:", error);
    }

    if (pendingToast) {
        showToast(pendingToast, "success");
    }
});

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
            return;
        }

        // Some forms (e.g. add-anime/add-manga) run their own submit
        // listeners that may still cancel submission (missing metadata,
        // user declined confirm dialog, etc). Only queue the toast if the
        // submission is actually going through.
        if (event.defaultPrevented) {
            return;
        }

        const title = titleInput?.value.trim();
        const entryType = form.dataset.entryType;
        const section = form.dataset.section;

        let label = "Item";
        if (section) {
            label = section;
        } else if (entryType === "anime") {
            label = "Anime";
        } else if (entryType === "manga") {
            label = "Manga";
        }

        const message = title ? `"${title}" added to ${label}!` : `${label} added successfully!`;
        try {
            sessionStorage.setItem("pendingAddToast", message);
        } catch (error) {
            console.error("Could not queue toast message:", error);
        }
    });

    scheduleValidation();
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".validated-add-form").forEach(setupValidatedAddForm);
});

function srtToVtt(text) {
    const normalized = String(text || "").replace(/\r+/g, "").trim();
    if (!normalized) return "WEBVTT\n\n";
    if (normalized.startsWith("WEBVTT")) return normalized;
    return `WEBVTT\n\n${normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}\n`;
}

function reportPlayerTracks(player, label = "Player") {
    if (!player) return;
    const audioTracks = player.audioTracks ? player.audioTracks() : null;
    const textTracks = player.textTracks ? player.textTracks() : null;
    console.log(`${label} audio tracks detected: ${audioTracks ? audioTracks.length : 0}`);
    console.log(`${label} subtitle/text tracks detected: ${textTracks ? textTracks.length : 0}`);
}

function setupSubtitleImport(player, inputId) {
    const input = document.getElementById(inputId);
    if (!player || !input) return;

    let currentTrack = null;
    let currentUrl = null;

    input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        try {
            const vtt = srtToVtt(await file.text());
            if (currentTrack) {
                player.removeRemoteTextTrack(currentTrack);
                currentTrack = null;
            }
            if (currentUrl) URL.revokeObjectURL(currentUrl);

            currentUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
            const remote = player.addRemoteTextTrack({
                kind: "subtitles",
                label: file.name.replace(/\.(srt|vtt)$/i, "") || "Imported subtitles",
                srclang: "external",
                src: currentUrl,
                default: true
            }, false);

            currentTrack = remote;
            const track = remote.track || remote;
            if (track) track.mode = "showing";
            input.dispatchEvent(new CustomEvent("subtitle-imported", { bubbles: true }));
            if (typeof showToast === "function") showToast(`Loaded subtitles: ${file.name}`, "success");
        } catch (error) {
            console.error("Subtitle import failed:", error);
            if (typeof showToast === "function") showToast("Could not load subtitle file", "error");
        } finally {
            input.value = "";
        }
    });
}

function setupPlayerTrackControls(player, options = {}) {
    if (!player) return;
    const audioSelect = document.getElementById(options.audioSelectId);
    const textSelect = document.getElementById(options.textSelectId);

    function populateAudioTracks() {
        if (!audioSelect) return;
        const tracks = player.audioTracks ? player.audioTracks() : null;
        audioSelect.innerHTML = "";

        if (!tracks || !tracks.length) {
            audioSelect.add(new Option("Default audio", ""));
            audioSelect.disabled = true;
            return;
        }

        audioSelect.disabled = tracks.length <= 1;
        for (let index = 0; index < tracks.length; index += 1) {
            const track = tracks[index];
            const label = track.label || track.language || `Audio ${index + 1}`;
            const option = new Option(label, String(index), false, Boolean(track.enabled));
            audioSelect.add(option);
        }
    }

    function populateTextTracks() {
        if (!textSelect) return;
        const tracks = player.textTracks ? player.textTracks() : null;
        textSelect.innerHTML = "";
        textSelect.add(new Option("Subtitles off", "off"));

        if (!tracks || !tracks.length) {
            textSelect.disabled = false;
            return;
        }

        for (let index = 0; index < tracks.length; index += 1) {
            const track = tracks[index];
            if (!["subtitles", "captions"].includes(track.kind)) continue;
            const label = track.label || track.language || `Subtitle ${index + 1}`;
            const option = new Option(label, String(index), false, track.mode === "showing");
            textSelect.add(option);
        }
        textSelect.disabled = false;
    }

    audioSelect?.addEventListener("change", () => {
        const tracks = player.audioTracks ? player.audioTracks() : null;
        if (!tracks) return;
        const activeIndex = Number(audioSelect.value);
        for (let index = 0; index < tracks.length; index += 1) {
            tracks[index].enabled = index === activeIndex;
        }
        populateAudioTracks();
    });

    textSelect?.addEventListener("change", () => {
        const tracks = player.textTracks ? player.textTracks() : null;
        if (!tracks) return;
        const activeIndex = textSelect.value === "off" ? -1 : Number(textSelect.value);
        for (let index = 0; index < tracks.length; index += 1) {
            if (["subtitles", "captions"].includes(tracks[index].kind)) {
                tracks[index].mode = index === activeIndex ? "showing" : "disabled";
            }
        }
        populateTextTracks();
    });

    const refresh = () => {
        populateAudioTracks();
        populateTextTracks();
    };

    player.ready(refresh);
    player.on("loadedmetadata", refresh);
    document.getElementById(options.subtitleInputId)?.addEventListener("subtitle-imported", () => {
        window.setTimeout(refresh, 80);
    });
}

function setupLibraryCompactSearch() {
    const library = document.querySelector(".anime-list");
    const strip = library?.querySelector(".library-control-strip");
    if (!library || !strip) return;

    let triggerY = 0;

    const measure = () => {
        const topGap = document.body.classList.contains("electron-shell") ? 66 : 26;
        triggerY = strip.getBoundingClientRect().top + window.scrollY - topGap;
    };

    const update = () => {
        library.classList.toggle("is-search-condensed", window.scrollY > triggerY);
    };

    measure();
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", () => {
        measure();
        update();
    });
}

document.addEventListener("DOMContentLoaded", setupLibraryCompactSearch);
