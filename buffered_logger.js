const fs = require('node:fs');

function createBufferedLogger(filename, { limit = 1000, writeFile = fs.promises.writeFile, onError = console.error } = {}) {
    const entries = [];
    let dirty = false;
    let pending = null;

    function flush() {
        if (pending) return pending;
        pending = Promise.resolve().then(async () => {
            while (dirty) {
                dirty = false;
                await writeFile(filename, JSON.stringify(entries, null, 4));
            }
        }).catch(onError).finally(() => {
            pending = null;
            if (dirty) flush();
        });
        return pending;
    }

    return function log(type, data) {
        entries.push({ timestamp: new Date().toISOString(), type, message: data.toString().trim().slice(0, 16384) });
        if (entries.length > limit) entries.splice(0, entries.length - limit);
        dirty = true;
        return flush();
    };
}

module.exports = { createBufferedLogger };
