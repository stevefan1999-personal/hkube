const EventEmitter = require('events');
const EtcdClient = require('@hkube/etcd');
const log = require('@hkube/logger').GetLogFromContainer();
const component = require('../../lib/consts/componentNames').ETCD;

class Etcd extends EventEmitter {
    constructor() {
        super();
        this._etcd = null;
    }

    async init(options) {
        this._etcd = new EtcdClient(options.etcd);
        log.info(`Initializing etcd with options: ${JSON.stringify(options.etcd)}`, { component });
        await this._etcd.jobs.state.watch({ jobId: 'hookWatch' });
    }

    getAlgorithmTemplate({ name }) {
        return this._etcd.algorithms.store.get({ name });
    }

    getAlgorithmTemplates() {
        return this._etcd.algorithms.store.list();
    }

    storeAlgorithmData(name, data) {
        return this._etcd.algorithms.debug.set({ name, ...data });
    }

    removeAlgorithmData(name) {
        return this._etcd.algorithms.debug.delete({ name });
    }

    async getPendingBuilds() {
        const list = await this._etcd.algorithms.builds.list({ sort: 'desc' });
        return list.filter(b => b.status === 'pending');
    }

    async setBuild(options) {
        const { buildId } = options;
        if (!buildId) {
            return;
        }
        await this._etcd.algorithms.builds.update(options);
    }
}

module.exports = new Etcd();