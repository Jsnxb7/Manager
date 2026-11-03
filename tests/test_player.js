const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installKeyboard, installProgress, initialize } = require('../static/js/player');

function fakePlayer() {
    const events = new Map();
    const state = { time: 20, duration: 60, volume: 0.5, paused: false, ended: false, muted: false, fullscreen: false, focus: 0 };
    const element = { contains: target => target.inside, focus: () => state.focus++ };
    const player = {
        on: (name, fn) => events.set(name, [...(events.get(name) || []), fn]),
        one: (name, fn) => player.on(name, fn),
        emit: name => (events.get(name) || []).forEach(fn => fn()),
        el: () => element,
        currentTime: value => value === undefined ? state.time : (state.time = value),
        duration: () => state.duration,
        volume: value => value === undefined ? state.volume : (state.volume = value),
        muted: value => value === undefined ? state.muted : (state.muted = value),
        paused: () => state.paused,
        ended: () => state.ended,
        pause: () => { state.paused = true; },
        play: () => { state.paused = false; return Promise.resolve(); },
        isFullscreen: () => state.fullscreen,
        requestFullscreen: () => { state.fullscreen = true; },
        exitFullscreen: () => { state.fullscreen = false; },
        userActive: () => {}
    };
    return { player, state };
}

function keyboard() {
    const { player, state } = fakePlayer();
    let handler;
    let removed = false;
    installKeyboard(player, {
        addEventListener: (name, fn, capture) => { assert.equal(capture, true); handler = fn; },
        removeEventListener: () => { removed = true; }
    });
    function key(key, extra = {}) {
        const event = {
            key, target: { closest: () => null },
            preventDefault() { this.prevented = true; },
            stopPropagation() { this.stopped = true; }, ...extra
        };
        handler(event);
        return event;
    }
    return { player, state, key, removed: () => removed };
}

test('arrows seek exactly ten seconds, cancel native handling, and clamp at both ends', () => {
    const { state, key } = keyboard();
    const event = key('ArrowRight');
    assert.equal(state.time, 30);
    assert.ok(event.prevented && event.stopped);
    state.time = 55;
    key('ArrowRight');
    assert.equal(state.time, 60);
    state.time = 5;
    key('ArrowLeft');
    assert.equal(state.time, 0);
    state.duration = NaN;
    key('ArrowRight');
    assert.equal(state.time, 0);
});

test('seek from a focused slider moves focus to the player', () => {
    const { key, state } = keyboard();
    key('ArrowRight', { target: { inside: true, closest: selector => selector.includes('[role="slider"]') ? {} : null } });
    assert.equal(state.focus, 1);
    assert.equal(state.time, 30);
});

test('typing, dropdowns, menu items, modified keys and Tab navigation retain defaults', () => {
    const { key, state } = keyboard();
    for (const selector of ['select', 'textarea', 'input', '[contenteditable]', '[role="menuitem"]']) {
        assert.equal(key('ArrowRight', { target: { closest: () => ({ selector }) } }).prevented, undefined);
    }
    assert.equal(key('ArrowRight', { altKey: true }).prevented, undefined);
    assert.equal(key('ArrowRight', { ctrlKey: true }).prevented, undefined);
    assert.equal(key('Tab').prevented, undefined);
    assert.equal(state.time, 20);
});

test('buttons retain Space activation and held toggle keys do not toggle repeatedly', () => {
    const { key, state } = keyboard();
    const target = { closest: selector => selector === 'button, a, [role="button"]' ? {} : null };
    assert.equal(key(' ', { target }).prevented, undefined);
    key('m');
    key('m', { repeat: true });
    assert.equal(state.muted, true);
    key('F');
    assert.equal(state.fullscreen, true);
});

function progress(beaconResult = false) {
    const { player, state } = fakePlayer();
    const requests = [], beacons = [], navigations = [];
    let now = 0;
    let pagehide;
    const env = {
        Date: { now: () => now },
        navigator: { sendBeacon: (url, body) => { beacons.push({ url, body }); return beaconResult; } },
        // A permanently stalled server must not prevent navigation.
        fetch: (url, options) => { requests.push({ url, ...options }); return new Promise(() => {}); },
        location: { assign: url => navigations.push(url) },
        addEventListener: (name, fn) => { if (name === 'pagehide') pagehide = fn; },
        removeEventListener: () => {}
    };
    installProgress(player, { identity: { anime_id: 1, episode_number: 2 }, progressUrl: '/progress', nextUrl: '/next?queue_after=2' }, env);
    return { player, state, requests, beacons, navigations, pagehide: () => pagehide(), advance: ms => { now += ms; } };
}

test('ended advances once even with a stalled progress request; unload retains completion', () => {
    const p = progress();
    p.player.emit('ended');
    assert.deepEqual(p.navigations, ['/next?queue_after=2']);
    assert.equal(p.requests[0].keepalive, true);
    assert.equal(JSON.parse(p.requests[0].body).completed, true);
    p.player.emit('ended');
    p.player.emit('pause');
    p.pagehide();
    assert.equal(p.navigations.length, 1);
    assert.ok(p.requests.every(request => JSON.parse(request.body).completed));
});

test('beacon succeeds without issuing a second network request', () => {
    const p = progress(true);
    p.player.emit('ended');
    assert.equal(p.beacons.length, 1);
    assert.equal(p.requests.length, 0);
    assert.equal(p.navigations.length, 1);
});

test('continuous timeupdate saves every eight seconds instead of postponing indefinitely', () => {
    const p = progress();
    for (let i = 0; i < 65; i++) {
        p.player.emit('timeupdate');
        p.advance(250);
    }
    assert.equal(p.requests.length, 3);
    assert.equal(p.navigations.length, 0);
});

test('timeupdate handles ended state but never advances early near the end', () => {
    const p = progress();
    p.state.time = 59.99;
    p.player.emit('timeupdate');
    assert.equal(p.navigations.length, 0);
    p.state.ended = true;
    p.player.emit('timeupdate');
    assert.equal(p.navigations.length, 1);
});

test('both player configurations initialize once and restore progress after metadata', () => {
    for (const custom of [false, true]) {
        const { player, state } = fakePlayer();
        let calls = 0;
        const video = { dataset: { animeId: '1', episodeNumber: '2', mediaId: custom ? '3' : '', resumeTime: '35', progressUrl: '/save' } };
        const env = {
            videojs: (el, options) => {
                calls++;
                assert.equal(el, video);
                assert.equal(options.inactivityTimeout, 2000);
                assert.equal(options.html5.nativeControlsForTouch, false);
                return player;
            },
            document: { getElementById: () => video, addEventListener: () => {}, removeEventListener: () => {} },
            location: { search: '?resume=1' },
            addEventListener: () => {}, removeEventListener: () => {}
        };
        initialize(env);
        assert.equal(calls, 1);
        assert.equal(state.time, 20);
        player.emit('loadedmetadata');
        assert.equal(state.time, 35);
    }
});

test('disposing the player removes the global keyboard listener', () => {
    const k = keyboard();
    k.player.emit('dispose');
    assert.equal(k.removed(), true);
});
