(function () {
    function setupJikanSearch(mediaType) {
        const input = document.getElementById("jikan-search-input");
        const results = document.getElementById("jikan-search-results");
        const status = document.getElementById("jikan-search-status");
        const malIdInput = document.getElementById("jikan-mal-id");
        if (!input || !results || !status || !malIdInput) return;

        let timer = null;
        let controller = null;
        let activeIndex = -1;

        function setStatus(message, isError = false) {
            status.textContent = message || "";
            status.classList.toggle("is-error", isError);
        }

        function closeResults() {
            results.replaceChildren();
            results.hidden = true;
            activeIndex = -1;
            input.setAttribute("aria-expanded", "false");
        }

        function setActive(index) {
            const options = [...results.querySelectorAll("button")];
            if (!options.length) return;
            activeIndex = Math.max(0, Math.min(index, options.length - 1));
            options.forEach((option, optionIndex) => {
                option.classList.toggle("is-active", optionIndex === activeIndex);
                option.setAttribute("aria-selected", optionIndex === activeIndex ? "true" : "false");
            });
            options[activeIndex].scrollIntoView({ block: "nearest" });
        }

        async function selectResult(result, button) {
            controller?.abort();
            controller = new AbortController();
            results.querySelectorAll("button").forEach(item => item.disabled = true);
            button.disabled = false;
            setStatus(`Loading ${result.title}…`);
            try {
                const response = await fetch(`/api/jikan/${mediaType}/${result.mal_id}`, { signal: controller.signal });
                const data = await response.json();
                if (!response.ok || data.status !== "success") throw new Error(data.message || "Could not load this result");
                malIdInput.value = String(data.item.mal_id);
                input.value = data.item.title;
                closeResults();
                setStatus(`Selected ${data.item.title}. Review and edit the filled fields below.`);
                document.dispatchEvent(new CustomEvent("jikan:item-selected", { detail: { mediaType, item: data.item } }));
            } catch (error) {
                if (error.name !== "AbortError") setStatus(error.message || "Could not load this result", true);
            }
        }

        function renderResults(items) {
            closeResults();
            if (!items.length) {
                setStatus("No Jikan results found. You can continue with manual entry.");
                return;
            }
            const fragment = document.createDocumentFragment();
            items.forEach((item, index) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "jikan-result";
                button.setAttribute("role", "option");
                button.setAttribute("aria-selected", "false");
                button.dataset.index = String(index);

                const image = document.createElement("img");
                image.src = item.image_url || "/static/placeholder.jpeg";
                image.alt = "";
                const body = document.createElement("span");
                body.className = "jikan-result-body";
                const title = document.createElement("strong");
                title.textContent = item.title;
                const alternate = document.createElement("span");
                alternate.textContent = item.title_english && item.title_english !== item.title ? item.title_english : (item.title_japanese || "");
                const meta = document.createElement("small");
                meta.textContent = [item.type, item.year, item.status, item.episodes ? `${item.episodes} eps` : ""].filter(Boolean).join(" · ");
                body.append(title, alternate, meta);
                button.append(image, body);
                button.addEventListener("click", () => selectResult(item, button));
                fragment.appendChild(button);
            });
            results.appendChild(fragment);
            results.hidden = false;
            input.setAttribute("aria-expanded", "true");
            setStatus(`${items.length} results. Choose one to fill the form.`);
        }

        async function search() {
            const query = input.value.trim();
            malIdInput.value = "";
            if (query.length < 2) {
                closeResults();
                setStatus(query ? "Type at least two characters." : "");
                return;
            }
            controller?.abort();
            controller = new AbortController();
            setStatus("Searching Jikan…");
            try {
                const params = new URLSearchParams({ media_type: mediaType, q: query });
                const response = await fetch(`/api/jikan/search?${params}`, { signal: controller.signal });
                const data = await response.json();
                if (!response.ok || data.status !== "success") throw new Error(data.message || "Jikan search failed");
                renderResults(data.results || []);
            } catch (error) {
                if (error.name !== "AbortError") {
                    closeResults();
                    setStatus(`${error.message || "Jikan search failed"}. Manual entry is still available.`, true);
                }
            }
        }

        input.addEventListener("input", () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(search, 400);
        });
        input.addEventListener("keydown", event => {
            const options = [...results.querySelectorAll("button")];
            if (event.key === "ArrowDown" && options.length) {
                event.preventDefault();
                setActive(activeIndex + 1);
            } else if (event.key === "ArrowUp" && options.length) {
                event.preventDefault();
                setActive(activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
            } else if (event.key === "Enter" && activeIndex >= 0) {
                event.preventDefault();
                options[activeIndex].click();
            } else if (event.key === "Escape") {
                closeResults();
            }
        });
        document.addEventListener("click", event => {
            if (event.target !== input && !results.contains(event.target)) closeResults();
        });
    }

    window.setupJikanSearch = setupJikanSearch;
})();
