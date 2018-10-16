const EventEmitter = require('events');
const { Consumer } = require('@hkube/producer-consumer');
const Etcd = require('@hkube/etcd');
const { tracer } = require('@hkube/metrics');
const { jobPrefix } = require('../consts/index');
const queueRunner = require('../queue-runner');
const log = require('@hkube/logger').GetLogFromContainer();
const component = require('../consts/component-name').JOBS_CONSUMER;

class JobConsumer extends EventEmitter {
    constructor() {
        super();
        this._consumer = null;
        this._options = null;
        this._job = null;
        this._active = false;
        this.etcd = new Etcd();
    }


    async init(options) {
        const { etcd, serviceName, algorithmType } = options;
        this._options = options;
        this.etcd.init({ etcd, serviceName });
        await this.etcd.jobState.watch();

        // this._registerMetrics();
        this._consumer = new Consumer({
            setting: {
                redis: options.redis,
                tracer,
                prefix: jobPrefix.JOB_PREFIX
            }
        });
        this._consumer.register({
            job: { type: algorithmType, concurrency: options.consumer.concurrency }
        });
        log.info(`registering for job ${options.algorithmType}`, { component });
        this._consumer.on('job', (job) => {
            this._handleJob(job);
        });

        this.etcd.jobState.on('change', (data) => {
            if (data && data.state === 'stop') {
                queueRunner.queue.removeJobId([data.jobId]);
            }
        });
    }

    async _handleJob(job) {
        try {
            const jobId = job.data.jobId;
            const data = await this.etcd.jobState.getState({ jobId });
            if (data && data.state === 'stop') {
                log.warning(`job arrived with state stop therefore will not added to queue : ${jobId}`, { component });
                queueRunner.queue.removeJobId([job.data.jobId]);
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

    pipelineToQueueAdapter({ jobId, pipelineName, priority, nodeName, algorithmName, info, spanId }, task, initialBatchLength) {
        return {
            jobId,
            pipelineName,
            algorithmName,
            priority,
            info,
            spanId,
            storage: task.storage,
            nodeName,
            initialBatchLength,
            batchPlace: task.batchIndex || 1,
            taskId: task.taskId,
            input: task.input,
            calculated: {
                latestScores: {},
                //  score: '1-100',
                entranceTime: Date.now(),
                enrichment: {}
            }
        };
    }

    queueTasksBuilder(job) {
        const { jobId, pipelineName, priority, nodeName, algorithmName, info, spanId } = job.data;
        const tasks = job.data.tasks.map(task => {
            return this.pipelineToQueueAdapter({ jobId, pipelineName, priority, nodeName, algorithmName, info, spanId }, task, job.data.tasks.length);
        });
        queueRunner.queue.add(tasks);
        job.done();
    }
}

module.exports = new JobConsumer();

