const clone = require('lodash.clonedeep');
const parse = require('@hkube/units-converter');
const { consts, gpuVendors } = require('../../lib/consts');
const { CPU_RATIO_PRESSURE, GPU_RATIO_PRESSURE, MEMORY_RATIO_PRESSURE, MAX_JOBS_PER_TICK } = consts;

const findNodeForSchedule = (node, requestedCpu, requestedGpu, requestedMemory) => {
    const freeCpu = node.free.cpu - (node.total.cpu * (1 - CPU_RATIO_PRESSURE));
    const freeGpu = node.free.gpu - (node.total.gpu * (1 - GPU_RATIO_PRESSURE));
    const freeMemory = node.free.memory - (node.total.memory * (1 - MEMORY_RATIO_PRESSURE));
    return requestedCpu < freeCpu && requestedMemory < freeMemory && requestedGpu <= freeGpu;
};

const nodeSelectorFilter = (labels, nodeSelector) => {
    let matched = true;
    if (!nodeSelector) {
        return true;
    }
    if (!labels) {
        return false;
    }
    Object.entries(nodeSelector).forEach(([k, v]) => {
        if (labels[k] !== v) {
            matched = false;
        }
    });
    return matched;
};

const shouldAddJob = (jobDetails, availableResources, totalAdded) => {
    if (totalAdded >= MAX_JOBS_PER_TICK) {
        return { shouldAdd: false, newResources: { ...availableResources } };
    }
    const requestedCpu = parse.getCpuInCore('' + jobDetails.resourceRequests.requests.cpu);
    const requestedGpu = jobDetails.resourceRequests.requests[gpuVendors.NVIDIA] || 0;
    const requestedMemory = parse.getMemoryInMi(jobDetails.resourceRequests.requests.memory);
    const nodeList = availableResources.nodeList.filter(n => nodeSelectorFilter(n.labels, jobDetails.nodeSelector));
    const nodeForSchedule = nodeList.find(r => findNodeForSchedule(r, requestedCpu, requestedGpu, requestedMemory));

    if (!nodeForSchedule) {
        return { shouldAdd: false, newResources: { ...availableResources } };
    }

    nodeForSchedule.free.cpu -= requestedCpu;
    nodeForSchedule.free.gpu -= requestedGpu;
    nodeForSchedule.free.memory -= requestedMemory;

    return { shouldAdd: true, newResources: { ...availableResources, allNodes: { ...availableResources.allNodes } } };
};

const _sortWorkers = (a, b) => {
    if (b.workerPaused > a.workerPaused) {
        return 1;
    }
    if (b.workerStatus === 'ready') {
        return 1;
    }
    return -1;
};

function _scheduleAlgorithmToNode(nodeList, { requestedCpu, requestedGpu, memoryRequests }) {
    const nodeForSchedule = nodeList.find(n => findNodeForSchedule(n, requestedCpu, requestedGpu, memoryRequests));
    return nodeForSchedule;
}

const _updateNodeResources = (nodeList, nodeName, { requestedCpu, requestedGpu, memoryRequests }) => {
    const nodeListLocal = nodeList.slice();
    const nodeIndex = nodeListLocal.findIndex(n => n.name === nodeName);
    if (nodeIndex === -1) {
        return nodeListLocal;
    }
    const node = clone(nodeListLocal[nodeIndex]);
    node.free = {
        cpu: node.free.cpu + requestedCpu,
        memory: node.free.memory + memoryRequests,
        gpu: node.free.gpu + requestedGpu
    };
    node.requests = {
        cpu: node.requests.cpu - requestedCpu,
        memory: node.requests.memory - memoryRequests,
        gpu: node.requests.gpu - requestedGpu

    };
    node.ratio = {
        cpu: node.requests.cpu / node.total.cpu,
        memory: node.requests.memory / node.total.memory,
        gpu: node.total.gpu ? node.requests.gpu / node.total.gpu : 0

    };

    nodeListLocal[nodeIndex] = node;
    return nodeListLocal;
};

const _findWorkersToStop = (nodeList, algorithmName, resources) => {
    let nodeListLocal = clone(nodeList);
    let workersToStop;
    const foundAny = nodeListLocal.some((n) => {
        let foundNode = null;
        const workers = n.workers.filter(w => w.algorithmName !== algorithmName);
        while (workers.length) {
            workersToStop = [];
            const worker = workers.shift();
            const requestedCpu = parse.getCpuInCore('' + worker.resourceRequests.requests.cpu);
            const memoryRequests = parse.getMemoryInMi(worker.resourceRequests.requests.memory);
            const requestedGpu = worker.resourceRequests.requests[gpuVendors.NVIDIA] || 0;
            nodeListLocal = _updateNodeResources(nodeListLocal, n.name, { requestedCpu, requestedGpu, memoryRequests });
            workersToStop.push(worker);
            foundNode = _scheduleAlgorithmToNode(nodeListLocal, resources);
            if (foundNode) {
                break;
            }
        }
        if (!foundNode) {
            nodeListLocal = clone(nodeList);
        }
        return foundNode;
    });
    if (foundAny) {
        return {
            nodeList: nodeListLocal,
            workersToStop
        };
    }
    return {
        nodeList
    };
};

const matchWorkersToNodes = (nodeList, workers) => {
    return nodeList.map(n => ({
        ...n,
        workers: workers.filter(w => w.nodeName === n.name)
    }));
};

const pauseAccordingToResources = (stopDetails, availableResources, workers, resourcesToFree, skippedRequests) => {
    // filter out debug workers
    const toStop = [];
    if (stopDetails.length === 0) {
        return { toStop };
    }
    let localDetails = stopDetails.map(sd => sd.details);
    const localResources = clone(availableResources);
    skippedRequests.forEach((r) => {
        const requestedCpu = parse.getCpuInCore('' + r.resourceRequests.requests.cpu);
        const memoryRequests = parse.getMemoryInMi(r.resourceRequests.requests.memory);
        const requestedGpu = r.resourceRequests.requests[gpuVendors.NVIDIA] || 0;
        // select just the nodes that match this request. sort from largest free space to smalles
        let nodeList = localResources.nodeList.filter(n => nodeSelectorFilter(n.labels, r.nodeSelector)).sort((a, b) => b.free.cpu - a.free.cpu);
        nodeList = matchWorkersToNodes(nodeList, localDetails);
        const workersToStopData = _findWorkersToStop(nodeList, r.algorithmName, { requestedCpu, requestedGpu, memoryRequests });
        if (workersToStopData.workersToStop) {
            nodeList = workersToStopData.nodeList; //eslint-disable-line
            localResources.nodeList.forEach((node) => {
                const newNode = nodeList.find(n => n.name === node.name);
                if (newNode) {
                    node.free = newNode.free;
                    node.requests = newNode.requests;
                    node.gpu = newNode.gpu;
                }
            });
            workersToStopData.workersToStop.forEach(w => toStop.push(w));
            localDetails = localDetails.filter(d => !workersToStopData.workersToStop.find(w => d.id === w.id));
        }
    });

    return { toStop };
};

const matchJobsToResources = (createDetails, availableResources) => {
    const created = [];
    const skipped = [];
    const localDetails = clone(createDetails);
    let addedThisTime = 0;
    let totalAdded = 0;
    // loop over all the job types one by one and assign until it can't fit in any node
    const cb = (j) => {
        if (j.numberOfNewJobs > 0) {
            const { shouldAdd, newResources } = shouldAddJob(j.jobDetails, availableResources, totalAdded);
            if (shouldAdd) {
                created.push({ ...j.jobDetails, createdTime: Date.now() });
            }
            else {
                skipped.push(j.jobDetails);
            }
            j.numberOfNewJobs -= 1;
            addedThisTime += 1;
            totalAdded += 1;
            availableResources = newResources;
        }
    };
    do {
        addedThisTime = 0;
        localDetails.forEach(cb);
    } while (addedThisTime > 0);

    return { created, skipped };
};

module.exports = {
    nodeSelectorFilter,
    matchJobsToResources,
    shouldAddJob,
    pauseAccordingToResources,
    _sortWorkers,
    matchWorkersToNodes
};
