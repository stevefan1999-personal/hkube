const Logger = require('@hkube/logger');
const fs = require('fs');
const component = require('../common/consts/componentNames').EXECUTOR;
const etcd = require('./helpers/etcd');
const kubernetes = require('./helpers/kubernetes');
const reconciler = require('./reconcile/reconciler');
let log;

class Executor {
    async init(options = {}) {
        log = Logger.GetLogFromContainer();
        this._intervalMs = options.intervalMs || 3000;
        // just for local testing. to be removed
        const versionsFilePath = `${__dirname}/../versions.json`;
        if (fs.existsSync(versionsFilePath)) {
            this._versions = JSON.parse(fs.readFileSync(versionsFilePath));
        }
        this._startInterval();
    }

    _startInterval() {
        setTimeout(this._intervalCallback.bind(this), this._intervalMs);
    }

    async _intervalCallback() {
        log.debug('Reconcile inteval.', { component });
        const versions = await kubernetes.getVersionsConfigMap() || this._versions;
        const algorithmRequests = await etcd.getAlgorithmRequests({});
        const algorithmPods = await etcd.getWorkers({});
        const jobs = await kubernetes.getWorkerJobs();
        // log.debug(`algorithmRequests: ${JSON.stringify(algorithmRequests, null, 2)}`, { component });
        // log.debug(`algorithmPods: ${JSON.stringify(algorithmPods, null, 2)}`, { component });
        // log.debug(`jobs: ${JSON.stringify(jobs, null, 2)}`, { component });
        const newConfig = await reconciler.reconcile({
            algorithmRequests, algorithmPods, jobs, versions
        });
        log.debug(`newConfig: ${JSON.stringify(newConfig, null, 2)}`, { component });
        setTimeout(this._intervalCallback.bind(this), this._intervalMs);
    }
}

module.exports = new Executor();