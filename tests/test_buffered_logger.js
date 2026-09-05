const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBufferedLogger } = require('../buffered_logger');

test('bursts are bounded and writes serialize while retaining new messages', async () => {
    const snapshots = [];
    let writing = false;
    const log = createBufferedLogger('unused', {
        limit: 3,
        writeFile: async (_filename, content) => {
            assert.equal(writing, false);
            writing = true;
            snapshots.push(JSON.parse(content));
            if (snapshots.length === 1) log('stdout', 'during-write');
            await new Promise(resolve => setImmediate(resolve));
            writing = false;
        }
    });
    for (let i = 0; i < 100; i++) log('stdout', i);
    await log('stdout', 'last');
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots[1].map(entry => entry.message), ['99', 'last', 'during-write']);
});

test('a failed write is reported and later messages can still be saved', async () => {
    let writes = 0;
    let errors = 0;
    const log = createBufferedLogger('unused', {
        writeFile: async () => { if (++writes === 1) throw new Error('Disk unavailable'); },
        onError: () => { errors++; }
    });
    await log('stderr', 'first');
    await log('stdout', 'second');
    assert.equal(errors, 1);
    assert.equal(writes, 2);
});
