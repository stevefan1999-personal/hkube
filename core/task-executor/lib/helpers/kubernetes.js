const Logger = require('@hkube/logger');
const KubernetesClient = require('@hkube/kubernetes-client').Client;
const objectPath = require('object-path');
const { components, containers } = require('../consts');
const { logWrappers } = require('./tracing');
const { cacheResults } = require('../utils/utils');
const component = components.K8S;
const CONTAINERS = containers;
let log;

class KubernetesApi {
    async init(options = {}) {
        log = Logger.GetLogFromContainer();
        this._client = new KubernetesClient(options.kubernetes);
        this._isNamespaced = options.kubernetes.isNamespaced;
        this._defaultQuota = options.resources.defaultQuota;
        log.info(`Initialized kubernetes client with options ${JSON.stringify({ ...options.kubernetes, url: this._client._config.url })}`, { component });
        if (options.healthchecks.logExternalRequests) {
            logWrappers([
                'getResourcesPerNode',
                'getWorkerJobs',
                'getPipelineDriversJobs',
                'getPodsForJob',
                'getVersionsConfigMap'
            ], this, log);
        }
        if ((options.cacheResults || {}).enabled) {
            this.getVersionsConfigMap = cacheResults(this.getVersionsConfigMap.bind(this), 5000);
            this.getResourcesPerNode = cacheResults(this.getResourcesPerNode.bind(this), 1000);
            this.getWorkerJobs = cacheResults(this.getWorkerJobs.bind(this), 1000);
            this.getPipelineDriversJobs = cacheResults(this.getPipelineDriversJobs.bind(this), 1000);
        }
    }

    async createJob({ spec, jobDetails = {} }) {
        log.info(`Creating job ${spec.metadata.name} ${jobDetails.hotWorker ? '[hot-worker]' : ''}`, { component });
        try {
            const res = await this._client.jobs.create({ spec });
            return res;
        }
        catch (error) {
            log.error(`unable to create job ${spec.metadata.name}. error: ${error.message}`, { component }, error);
        }
        return null;
    }

    async deleteJob(jobName) {
        log.info(`Deleting job ${jobName}`, { component });
        try {
            const res = await this._client.jobs.delete({ jobName });
            return res;
        }
        catch (error) {
            log.error(`unable to delete job ${jobName}. error: ${error.message}`, { component }, error);
        }
        return null;
    }

    async getWorkerJobs() {
        const jobsRaw = await this._client.jobs.get({ labelSelector: `type=${CONTAINERS.WORKER},group=hkube` });
        return jobsRaw;
    }

    async getPipelineDriversJobs() {
        const jobsRaw = await this._client.jobs.get({ labelSelector: `type=${CONTAINERS.PIPELINE_DRIVER},group=hkube` });
        return jobsRaw;
    }

    async getPodsForJob(job) {
        if (!job) {
            return [];
        }
        const podSelector = objectPath.get(job, 'spec.selector.matchLabels');
        if (!podSelector) {
            return [];
        }
        const pods = await this._client.pods.get({ labelSelector: podSelector });
        return pods;
    }

    async getVersionsConfigMap() {
        try {
            const res = await this._client.configMaps.get({ name: 'hkube-versions' });
            return this._client.configMaps.extractConfigMap(res);
        }
        catch (error) {
            log.error(`unable to get configmap. error: ${error.message}`, { component }, error);
            return {};
        }
    }

    async _getNamespacedResources() {
        const podsRaw = await this._client.pods.all(true);
        const pods = {
            body: {
                items: podsRaw.body.items.map((p) => {
                    objectPath.set(p, 'spec.nodeName', 'virtual-node');
                    return p;
                })
            }
        };
        const quota = await this._client.resourcequotas.get();
        const hard = objectPath.get(quota, 'body.items.0.spec.hard', this._defaultQuota);
        const cpu = hard['limits.cpu'] || 0;
        const memory = hard['limits.memory'] || 0;
        const gpu = hard['requests.nvidia.com/gpu'] || 0;

        const node = {
            metadata: {
                name: 'virtual-node'
            },
            status: {
                allocatable: {
                    cpu,
                    memory,
                    'nvidia.com/gpu': gpu
                }
            }
        };
        const nodes = {
            body: {
                items: [
                    node
                ]
            }
        };
        return { pods, nodes };
    }

    async getResourcesPerNode() {
        if (this._isNamespaced) {
            return this._getNamespacedResources();
        }
        const [pods, nodes] = await Promise.all([this._client.pods.all(), this._client.nodes.all()]);
        return { pods, nodes };
    }
}

module.exports = new KubernetesApi();
module.exports.KubernetesApi = KubernetesApi;
