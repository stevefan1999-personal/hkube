const Metric = require('../Metric');
const { groupBy } = require('../../utils/utils');
const queueUtils = require('../../utils/algorithm-queue');
const AlgorithmRatios = require('../../resources/ratios-allocator');
const ResourceAllocator = require('../../resources/resource-allocator');

class PrometheusMetric extends Metric {
    constructor(options, name) {
        super(options, name);
        this.weight = 0.1;
    }

    calc(options) {
        const algorithmQueue = queueUtils.order(options.algorithms.queue);
        const allocations = groupBy(algorithmQueue, 'name');
        const keys = Object.keys(allocations);
        const algorithms = options.algorithms.prometheus.filter(p => keys.includes(p.algorithmName)).map(p => ({ name: p.algorithmName, value: p.runTime }));
        const algorithmRatios = new AlgorithmRatios({ algorithms, allocations });
        const resourceAllocator = new ResourceAllocator({ resourceThresholds: this.options.resourceThresholds, ...options.algorithms });

        let algorithm = null;
        const algorithmGen = algorithmRatios.generateRandom();
        while (algorithm = algorithmGen.next().value) {
            resourceAllocator.allocate(algorithm.name);
        }
        let results = resourceAllocator.results();
        results = queueUtils.normalize(options.algorithms.queue, results);
        return results;
    }
}

module.exports = PrometheusMetric;
