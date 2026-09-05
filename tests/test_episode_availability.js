const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual IPC handler without launching an Electron window.
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const checkerSource = source.slice(source.indexOf('function getEpisodeNumberFromFilename'), source.indexOf('function saveConfig'));

function setup(files) {
    let handler;
    let scans = 0;
    const context = {
        path,
        VIDEO_EXTENSIONS: new Set(['.mp4', '.mkv']),
        fs: { promises: {
            stat: async target => {
                if (target === 'library') return { isDirectory: () => true, isFile: () => false };
                if (files.includes(path.basename(target))) return { isFile: () => true, isDirectory: () => false };
                throw new Error('Missing');
            },
            readdir: async () => {
                scans++;
                await new Promise(resolve => setImmediate(resolve));
                return files.map(name => ({ name, isFile: () => true, isSymbolicLink: () => false }));
            }
        } },
        ipcMain: { handle: (_name, callback) => { handler = callback; } }
    };
    vm.runInNewContext(checkerSource, context);
    return { check: payload => handler(null, payload), scans: () => scans };
}

test('fallback checks scan a season once and keep absolute-number ordering', async () => {
    const checker = setup(['14.mkv', '15.mkv']);
    const result = await checker.check({ directory: 'library', episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] });
    assert.equal(checker.scans(), 1);
    assert.equal(result.episodes[0].resolved_path, path.join('library', '14.mkv'));
    assert.equal(result.episodes[1].resolved_path, path.join('library', '15.mkv'));
    assert.equal(result.episodes[2].exists, false);
    assert.equal(result.anime.found_count, 2);
});

test('direct paths avoid folder scans and each new check sees added media', async () => {
    const files = ['14.mkv'];
    const checker = setup(files);
    const direct = await checker.check({ directory: 'library', episodes: [{ number: 1, file_path: path.join('library', '14.mkv') }] });
    assert.equal(direct.episodes[0].match_type, 'direct');
    assert.equal(checker.scans(), 0);
    const payload = { directory: 'library', episodes: [{ number: 2 }] };
    assert.equal((await checker.check(payload)).episodes[0].exists, false);
    files.push('15.mkv');
    assert.equal((await checker.check(payload)).episodes[0].exists, true);
    assert.equal(checker.scans(), 2);
});

test('large batches yield to the event loop and share one listing', async () => {
    const checker = setup(['14.mkv']);
    let yielded = false;
    setImmediate(() => { yielded = true; });
    await checker.check({ directory: 'library', episodes: Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })) });
    assert.equal(yielded, true);
    assert.equal(checker.scans(), 1);
});
