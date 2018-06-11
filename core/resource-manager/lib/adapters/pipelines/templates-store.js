
const Adapter = require('../Adapter');
const Cache = require('../../cache/cache-provider');

class TemplatesStoreAdapter extends Adapter {
    constructor(options, name) {
        super(options, name);
        this._cache = new Cache({ key: this.name, maxAge: 1000 * 60 * 5 });
    }

    async getData() {
        const data = Object.create(null);
        data['pipeline-driver'] = {
            cpu: 0.1,
            mem: 0
        };
        return data;
    }
}

module.exports = TemplatesStoreAdapter;
