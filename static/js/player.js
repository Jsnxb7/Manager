/* Shared, explicitly initialized Video.js player for library and custom media. */
(function (root) {
    'use strict';

    function installKeyboard(player, doc) {
        const element = player.el();
        function handleKey(event) {
            const target = event.target;
            if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
            if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menuitem"]')) return;
            // Let Tab-focused buttons retain their normal Space/Enter activation.
            if (event.key === ' ' && target?.closest('button, a, [role="button"]')) return;
            const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
            if (![' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', 'm'].includes(key)) return;
            event.preventDefault();
            // Run once, before Video.js sliders or browser defaults handle the key.
            event.stopPropagation();
            if (event.repeat && [' ', 'f', 'm'].includes(key)) return;

            const duration = player.duration();
            switch (key) {
                case ' ': {
                    if (player.paused()) player.play()?.catch(() => {});
                    else player.pause();
                    break;
                }
                case 'ArrowLeft':
                case 'ArrowRight': {
                    if (!Number.isFinite(duration) || duration <= 0) break;
                    const offset = key === 'ArrowLeft' ? -10 : 10;
                    player.currentTime(Math.max(0, Math.min(duration, player.currentTime() + offset)));
                    break;
                }
                case 'ArrowUp': player.volume(Math.min(1, player.volume() + 0.1)); break;
                case 'ArrowDown': player.volume(Math.max(0, player.volume() - 0.1)); break;
                case 'm': player.muted(!player.muted()); break;
                case 'f':
                    if (player.isFullscreen()) player.exitFullscreen();
                    else player.requestFullscreen();
                    break;
            }
            // A seek should not leave a slider focused and its controls pinned open.
            if (target !== element && element.contains(target) && target?.closest('[role="slider"], video')) {
                element.focus({ preventScroll: true });
            }
            player.userActive(true);
        }
        doc.addEventListener('keydown', handleKey, true);
        player.on('dispose', () => doc.removeEventListener('keydown', handleKey, true));
    }

    function installProgress(player, config, env) {
        let completed = false;
        let lastSavedAt = -Infinity;
        const finiteTime = value => Number.isFinite(value) ? Math.max(0, value) : 0;

        function save(useBeacon = false) {
            const currentTime = finiteTime(player.currentTime());
            const duration = finiteTime(player.duration());
            if (!currentTime && !duration && !completed) return;
            const body = JSON.stringify({
                ...config.identity,
                current_time: currentTime,
                total_duration: duration,
                completed
            });
            if (useBeacon && env.navigator.sendBeacon) {
                try {
                    if (env.navigator.sendBeacon(config.progressUrl, new Blob([body], { type: 'application/json' }))) return;
                } catch (error) { /* Fall back to keepalive when beacon is unavailable. */ }
            }
            env.fetch(config.progressUrl, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body, keepalive: true
            }).then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
            }).catch(error => console.warn('Could not save playback progress:', error));
        }

        function finish() {
            if (completed) return;
            completed = true;
            // Saving must never hold the next episode hostage to a stalled request.
            save(true);
            if (config.nextUrl) env.location.assign(config.nextUrl);
        }

        player.on('ended', finish);
        player.on('timeupdate', () => {
            if (player.ended()) { finish(); return; }
            // Do not debounce timeupdate: it fires continuously during playback.
            const now = env.Date.now();
            if (!completed && now - lastSavedAt >= 8000) {
                lastSavedAt = now;
                save();
            }
        });
        player.on('pause', () => {
            if (player.ended()) finish();
            else if (!completed) save();
        });
        const onPageHide = () => save(true);
        env.addEventListener('pagehide', onPageHide);
        player.on('dispose', () => env.removeEventListener('pagehide', onPageHide));
        return { save, finish };
    }

    function initialize(env) {
        const video = env.document.getElementById('video-player');
        if (!video) return;
        const data = { ...video.dataset };
        const custom = Boolean(data.mediaId);
        const player = env.videojs(video, {
            controls: true,
            autoplay: true,
            playsinline: true,
            preload: 'auto',
            inactivityTimeout: 2000,
            playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
            userActions: { hotkeys: false },
            html5: {
                nativeControlsForTouch: false,
                nativeAudioTracks: true,
                nativeTextTracks: true,
                nativeVideoTracks: true
            },
            controlBar: {
                skipButtons: { backward: 10, forward: 10 },
                remainingTimeDisplay: false,
                pictureInPictureToggle: true
            }
        });
        installKeyboard(player, env.document);
        installProgress(player, {
            identity: custom ? { media_id: Number(data.mediaId) } : {
                anime_id: Number(data.animeId), episode_number: Number(data.episodeNumber)
            },
            progressUrl: data.progressUrl,
            nextUrl: data.nextUrl
        }, env);

        player.one('loadedmetadata', () => {
            const resume = new URLSearchParams(env.location.search).get('resume') === '1';
            const time = Number(data.resumeTime);
            const duration = player.duration();
            if (resume && time > 1 && Number.isFinite(duration) && time < duration - 1) player.currentTime(time);
        });
        env.setupSubtitleImport?.(player, custom ? 'cp-subtitle-import-input' : 'subtitle-import-input');
        env.setupPlayerTrackControls?.(player, {
            audioSelectId: custom ? 'cp-audio-track-select' : 'player-audio-track-select',
            textSelectId: custom ? 'cp-subtitle-track-select' : 'player-subtitle-track-select',
            subtitleInputId: custom ? 'cp-subtitle-import-input' : 'subtitle-import-input'
        });
        return player;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { installKeyboard, installProgress, initialize };
    } else if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', () => initialize(root), { once: true });
    } else {
        initialize(root);
    }
})(typeof window !== 'undefined' ? window : globalThis);
