const EventEmitter = require('events');
const { Consumer } = require('@hkube/producer-consumer');
const log = require('@hkube/logger').GetLogFromContainer();
const Etcd = require('@hkube/etcd');
const { tracer } = require('@hkube/metrics');
const { jobPrefix, heuristicsName } = require('../consts/index');
const queueRunner = require('../queue-runner');
const component = require('../consts/component-name').JOBS_CONSUMER;

class JobConsumer extends EventEmitter {
    constructor() {
        super();
        this._consumer = null;
        this._options = null;
        this._job = null;
        this._active = false;
    }

    async init(options) {
        const { etcd, serviceName, algorithmType } = options;
        this._options = options;
        this.etcd = new Etcd({ ...etcd, serviceName });
        await this.etcd.jobs.state.watch();
        await this.etcd.algorithms.executions.watch();

        log.info(`registering for job ${options.algorithmType}`, { component });

        this._consumer = new Consumer({ setting: { redis: options.redis, tracer, prefix: jobPrefix.JOB_PREFIX } });
        this._consumer.on('job', (job) => {
            this._handleJob(job);
        });
        this.etcd.jobs.state.on('change', (data) => {
            if (data && data.state === 'stop') {
                const { jobId } = data;
                queueRunner.queue.removeJobs([{ jobId }]);
            }
        });
        this.etcd.algorithms.executions.on('change', (data) => {
            if (data && data.state === 'stop') {
                const { jobId, taskId } = data;
                queueRunner.queue.removeJobs([{ jobId, taskId }]);
            }
        });
        this._consumer.register({ job: { type: algorithmType, concurrency: options.consumer.concurrency } });
    }

    async _handleJob(job) {
        try {
            const { jobId } = job.data;
            const data = await this.etcd.jobs.state.get({ jobId });
            if (data && data.state === 'stop') {
                log.warning(`job arrived with state stop therefore will not added to queue : ${jobId}`, { component });
                queueRunner.queue.removeJobs([{ jobId }]);
            }
            else {
                log.info(`job arrived with inputs amount: ${job.data.tasks.length}`, { component });
                this.queueTasksBuilder(job);
            }
        }
        catch (error) {
            job.done(error);
        }
        finally {
            job.done();
        }
    }

    pipelineToQueueAdapter(jobData, taskData, initialBatchLength) {
        const { jobId, pipelineName, priority, nodeName, algorithmName, info, spanId, nodeType } = jobData;
        const latestScores = Object.values(heuristicsName).reduce((acc, cur) => {
            acc[cur] = 0.00001;
            return acc;
        }, {});
        const batchIndex = taskData.batchIndex || 1;
        const entranceTime = Date.now();
        return {
            jobId,
            pipelineName,
            algorithmName,
            priority,
            info,
            spanId,
            nodeType,
            nodeName,
            entranceTime,
            attempts: 0,
            initialBatchLength,
            calculated: {
                latestScores,
                //  score: '1-100',
                entranceTime,
                enrichment: {
                    batchIndex: {}
                }
            },
            ...taskData,
            batchIndex
        };
    }

    queueTasksBuilder(job) {
        const { tasks } = job.data;
        const taskList = tasks.map(task => this.pipelineToQueueAdapter(job.data, task, tasks.length));
        queueRunner.queue.add(taskList);
        job.done();
    }
}

module.exports = new JobConsumer();
