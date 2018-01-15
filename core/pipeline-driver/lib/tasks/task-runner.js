const producer = require('../producer/jobs-producer');
const consumer = require('../consumer/jobs-consumer');
const stateManager = require('../state/state-manager');
const progress = require('../progress/nodes-progress');
const NodesMap = require('../nodes/nodes-map');
const States = require('../state/States');
const Events = require('../consts/Events');
const RateLimiter = require('limiter').RateLimiter;
const limiter = new RateLimiter(100, 250);
const { parser } = require('@hkube/parsers');
const Batch = require('../nodes/node-batch');
const WaitBatch = require('../nodes/node-wait-batch');
const Node = require('../nodes/node');
const log = require('@hkube/logger').GetLogFromContainer();
const components = require('../../common/consts/componentNames');
const { metricsNames } = require('../consts/metricsNames');
const metrics = require('@hkube/metrics');
const { tracer } = require('@hkube/metrics');

let tasksCompleted = 0;

class TaskRunner {

    constructor() {
        this._job = null;
        this._jobId = null;
        this._pipeline = null;
        this._nodes = null;
        this._active = false;
        this._pipelineName = null;
    }

    init(options) {
        this._config = options;
        consumer.on(Events.JOBS.START, async (job) => {
            try {
                await this._startPipeline(job);
            }
            catch (error) {
                this._stopPipeline(error);
            }
        });
        stateManager.on(Events.JOBS.STOP, (data) => {
            this._stopPipeline(null, data.reason);
        });
        producer.on(Events.TASKS.WAITING, (taskId) => {
            this._setTaskState(taskId, { status: States.PENDING });
        });
        stateManager.on(Events.TASKS.ACTIVE, (data) => {
            this._setTaskState(data.taskId, { status: States.ACTIVE });
        });
        stateManager.on(Events.TASKS.SUCCEED, async (data) => {
            await this._setTaskState(data.taskId, { status: data.status, result: data.result });
            this._taskComplete(data.taskId);
        });
        stateManager.on(Events.TASKS.FAILED, async (data) => {
            await this._setTaskState(data.taskId, { status: data.status, error: data.error });
            this._taskComplete(data.taskId);
        });
        metrics.addTimeMeasure({
            name: metricsNames.pipelines_net,
            labels: ['pipeline_name', 'status'],
            buckets: [1, 2, 4, 8, 16, 32, 64, 128, 256].map(t => t * 1000)
        });
    }

    async _startPipeline(job) {
        this._active = true;
        this._job = job;
        this._jobId = job.id;
        log.info(`pipeline started ${this._jobId}`, { component: components.TASK_RUNNER });

        const watchState = await stateManager.watchJobState({ jobId: this._jobId });
        if (watchState && watchState.state === States.STOP) {
            this._stopPipeline(null, watchState.reason);
            return;
        }

        await stateManager.watchTasks({ jobId: this._jobId });
        this._pipeline = await stateManager.getExecution({ jobId: this._jobId });

        if (!this._pipeline) {
            throw new Error(`unable to find pipeline ${this._jobId}`);
        }
        this._pipelineName = this._pipeline.name;
        this._nodes = new NodesMap(this._pipeline);
        this._nodes.on('node-ready', (node) => {
            log.debug(`new node ready to run: ${node.nodeName}`, { component: components.TASK_RUNNER });
            this._runNode(node.nodeName, node.parentOutput, node.index);
        })

        progress.calcMethod(this._nodes.calcProgress.bind(this._nodes));

        this._startMetrics();

        const state = await stateManager.getState({ jobId: this._jobId });
        if (state) {
            log.info(`starting recover process ${this._jobId}`, { component: components.TASK_RUNNER });
            stateManager.setDriverState({ jobId: this._jobId, data: States.RECOVERING });
            const tasks = this._checkRecovery(state);
            await this._recoverPipeline(tasks);
        }
        else {
            stateManager.setDriverState({ jobId: this._jobId, data: States.ACTIVE });
            progress.info({ jobId: this._jobId, pipeline: this._pipelineName, status: States.ACTIVE });

            const entryNodes = this._nodes.findEntryNodes();
            if (entryNodes.length === 0) {
                throw new Error('unable to find entry nodes');
            }
            entryNodes.forEach(n => this._runNode(n));
        }
    }

    async _stopPipeline(error, reason) {
        if (!this._active) {
            return;
        }
        this._active = false;
        let status;
        if (error) {
            status = States.FAILED;
            log.error(`pipeline failed ${error.message}`, { component: components.TASK_RUNNER });
            progress.error({ jobId: this._jobId, pipeline: this._pipelineName, status, error: error.message });
            stateManager.setJobResults({ jobId: this._jobId, pipeline: this._pipelineName, data: { error: error.message, status } });
            this._job.done(error.message);
        }
        else {
            if (reason) {
                status = States.STOPPED;
                log.info(`pipeline stopped ${this._jobId}. ${reason}`, { component: components.TASK_RUNNER });
                progress.info({ jobId: this._jobId, pipeline: this._pipelineName, status });
                stateManager.setJobResults({ jobId: this._jobId, pipeline: this._pipelineName, data: { reason, status } });
            }
            else {
                status = States.COMPLETED;
                log.info(`pipeline completed ${this._jobId}`, { component: components.TASK_RUNNER });
                progress.info({ jobId: this._jobId, pipeline: this._pipelineName, status });
                const result = this._nodes.nodesResults();
                stateManager.setJobResults({ jobId: this._jobId, pipeline: this._pipelineName, data: { result, status } });
            }
        }
        await stateManager.unWatchJobState({ jobId: this._jobId });
        await stateManager.unWatchTasks({ jobId: this._jobId });
        const tasks = await stateManager.getDriverTasks({ jobId: this._jobId });
        if (tasks) {
            await Promise.all(tasks.map(t => producer.stopJob({ type: t.algorithmName, jobID: this._jobId })));
        }
        this._endMetrics(status);
        this._pipeline = null;
        this._nodes = null;
        this._job.done();
        this._job = null;
        this._jobId = null;
    }

    async _recoverPipeline(tasks) {
        for (let task of tasks) {
            log.info(`found ${task.status} task ${task.taskId} during recover`, { component: components.TASK_RUNNER });
            await this._setTaskState(task.taskId, task);
            this._taskComplete(task.taskId);
        }
    }

    _checkRecovery(state) {
        const tasksToRun = [];
        state.driverTasks.forEach(driverTask => {
            const jobTask = state.jobTasks.get(driverTask.taskId);
            if (jobTask && jobTask.status !== driverTask.status) {
                driverTask.result = jobTask.result;
                driverTask.status = jobTask.status;
                driverTask.error = jobTask.error;
                tasksToRun.push(driverTask);
            }
            if (driverTask.waitBatch) {
                this._nodes.addBatch(new WaitBatch(driverTask));
            }
            else if (driverTask.batchID) {
                this._nodes.addBatch(new Batch(driverTask));
            }
            else {
                this._nodes.setNode(new Node(driverTask));
            }
        })
        return tasksToRun;
    }

    _startMetrics() {
        if (!this._jobId && !this._pipelineName) {
            return;
        }
        metrics.get(metricsNames.pipelines_net).start({
            id: this._jobId,
            labelValues: {
                pipeline_name: this._pipelineName
            }
        });
        tracer.startSpan({
            name: 'startPipeline',
            id: this._jobId
        })
    }

    _endMetrics(status) {
        if (!this._jobId && !this._pipelineName) {
            return;
        }
        metrics.get(metricsNames.pipelines_net).end({
            id: this._jobId,
            labelValues: {
                status
            }
        });
        const topSpan = tracer.topSpan(this._jobId);
        if (topSpan) {
            topSpan.addTag({ status });
            topSpan.finish();
        }
    }

    _runNode(nodeName, parentOutput, index) {
        const node = this._nodes.getNode(nodeName);

        const options = Object.assign({},
            { flowInput: this._pipeline.flowInput },
            { nodeInput: node.input },
            { parentOutput: parentOutput },
            { index: index });

        const result = parser.parse(options);

        if (index) {
            this._runWaitAnyBatch(node, result.input);
        }
        else if (result.batch) {
            this._runNodeBatch(node, result.input);
        }
        else {
            this._runNodeSimple(node, result.input);
        }
    }

    _runWaitAnyBatch(node, result) {
        const waitNode = new WaitBatch({
            nodeName: node.nodeName,
            algorithmName: node.algorithmName,
            input: result
        });
        this._nodes.addBatch(waitNode);
        this._setTaskState(waitNode.taskId, waitNode);
        this._createJob(waitNode);
    }

    _runNodeSimple(node, input) {
        this._nodes.setNode(new Node({ ...node, input }));
        this._setTaskState(node.taskId, node);
        this._createJob(node);
    }

    _runNodeBatch(node, batchArray) {
        if (!Array.isArray(batchArray)) {
            throw new Error(`node ${node.nodeName} batch input must be an array`);
        }
        batchArray.forEach((inp, ind) => {
            const batch = new Batch({
                nodeName: node.nodeName,
                batchID: `${node.nodeName}#${(ind + 1)}`,
                batchIndex: (ind + 1),
                algorithmName: node.algorithmName,
                input: inp
            });
            this._nodes.addBatch(batch);
            this._setTaskState(batch.taskId, batch);
            this._createJob(batch);
        })
    }

    _taskComplete(taskId) {
        if (!this._active) {
            return;
        }
        const task = this._nodes.getNodeByTaskID(taskId);
        if (!task) {
            return;
        }
        const error = this._checkBatchTolerance(task);
        if (error) {
            this._stopPipeline(error);
        }
        else if (this._nodes.isAllNodesCompleted()) {
            this._stopPipeline();
        }
        else {
            this._nodes.updateCompletedTask(task);
        }
    }

    _checkBatchTolerance(task) {
        let error;
        if (task.error) {
            if (task.batchID || task.waitBatch) {
                const batchTolerance = this._pipeline.options.batchTolerance;
                const states = this._nodes.getNodeStates(task.nodeName);
                const failed = states.filter(s => s === States.FAILED);
                const percent = failed.length / states.length * 100;

                if (percent >= batchTolerance) {
                    error = new Error(`${failed.length}/${states.length} (${percent}%) failed tasks, batch tolerance is ${batchTolerance}%, error: ${task.error}`);
                }
            }
            else {
                error = new Error(`${task.error}`);
            }
        }
        return error;
    }

    async _setTaskState(taskId, options) {
        if (!this._active) {
            return;
        }
        if (options.error) {
            log.error(`task ${options.status} ${taskId}. error: ${options.error}`, { component: components.TASK_RUNNER });
        }
        else {
            log.debug(`task ${options.status} ${taskId}`, { component: components.TASK_RUNNER });
        }
        // await this._updateState(taskId, options);
        const task = this._nodes.updateTaskState(taskId, options);
        await progress.debug({ jobId: this._jobId, pipeline: this._pipelineName, status: States.ACTIVE });
        await stateManager.setTaskState({ jobId: this._jobId, taskId, data: task });
    }

    async _updateState(taskId, options) {
        return new Promise((resolve, reject) => {
            limiter.removeTokens(1, async (err, remainingRequests) => {
                if (err) {
                    log.error(err);
                }
                if (remainingRequests < 1) {
                    log.error(remainingRequests);
                }
                else {
                    const task = this._nodes.updateTaskState(taskId, options);
                    await progress.debug({ jobId: this._jobId, pipeline: this._pipelineName, status: States.ACTIVE });
                    await stateManager.setTaskState({ jobId: this._jobId, taskId: task.taskId, data: task });
                    log.info(`tasks completed #${++tasksCompleted}, remaining #${remainingRequests}`, { component: components.TASK_RUNNER });
                    return resolve();
                }
            });
        });
    }

    async _createJob(node) {
        const options = {
            type: node.algorithmName,
            data: {
                input: node.input,
                node: node.batchID || node.nodeName,
                jobID: this._jobId,
                taskID: node.taskId
            }
        }
        await producer.createJob(options);
    }
}

module.exports = new TaskRunner();
