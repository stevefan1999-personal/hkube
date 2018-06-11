const Metric = require('../Metric');
const queueUtils = require('../../utils/algorithm-queue');
const ResourceAllocator = require('../../resources/resource-allocator');
const log = require('@hkube/logger').GetLogFromContainer();
const component = require('../../../common/consts/componentNames').RUNNER;

class QueueMetric extends Metric {
    constructor(options, name) {
        super(options, name);
        this.weight = 0.7;
    }

    calc(options) {
        let results = Object.create(null);
        const queue = queueUtils.order(options.algorithms.queue);
        this._text(options.algorithms.queue);
        if (queue.length > 0) {
            const resourceAllocator = new ResourceAllocator({ resourceThresholds: this.options.resourceThresholds, ...options.algorithms });
            queue.forEach(r => resourceAllocator.allocate(r.name));
            results = resourceAllocator.results();
        }
        results = queueUtils.normalize(options.algorithms.queue, results);
        return results;
    }

    _text(queue) {
        const text = queue.map(q => `${q.data.length + q.pendingAmount} ${q.queueName}`).sort().join(', ');
        if (text !== this._state) {
            log.debug(`request queue: ${text}`, { component });
            this._state = text;
        }
    }
}

module.exports = QueueMetric;
