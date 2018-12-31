const Logger = require('@hkube/logger');
const storageManager = require('@hkube/storage-manager');
const { tracer } = require('@hkube/metrics');
const algoRunnerCommunication = require('../algorithm-communication/workerCommunication');
const discovery = require('../states/discovery');
const messages = require('../algorithm-communication/messages');
const { Status, EventMessages, ApiServerPostTypes, workerStates, Components } = require('../consts');
const apiServerClient = require('../helpers/api-server-client');
const jobConsumer = require('../consumer/JobConsumer');
const stateManager = require('../states/stateManager');


const component = Components.WORKER;
let log;

class SubPipelineHandler {
    init() {
        log = Logger.GetLogFromContainer();
        // subpipeline IDs mapping: jobId => internal alg subpipeline Id
        this._jobId2InternalIdMap = new Map();

        this._registerToEtcdEvents();
        this._registerToAlgEvents();
    }

    _registerToEtcdEvents() {
        // handle subpipeline job completed
        discovery.on(`${EventMessages.JOB_RESULT}-${Status.COMPLETED}`, (result) => {
            const subpipelineId = this._getAndCleanAlgSubPipelineId(result);
            this._handleSubPipelineCompleted(result, subpipelineId);
        });

        // handle subpipeline job stopped
        discovery.on(`${EventMessages.JOB_RESULT}-${Status.STOPPED}`, (result) => {
            const subpipelineId = this._getAndCleanAlgSubPipelineId(result);
            this._handleSubPipelineStopped(result, subpipelineId);
        });

        // handle subpipeline job failed
        discovery.on(`${EventMessages.JOB_RESULT}-${Status.FAILED}`, (result) => {
            const subPipelineId = this._getAndCleanAlgSubPipelineId(result);
            if (!this._validateWorkingState('send subPipelineError')) {
                return;
            }
            const err = (result.error && result.error.message) || result.error || 'subpipeline job failed';
            this._finishSubPipelineSpan(subPipelineId, Status.FAILED, err);
            this._handleJobError(err, subPipelineId);
        });
    }

    _registerToAlgEvents() {
        // handle 'startRawSubPipeline' from algorithm
        algoRunnerCommunication.on(messages.incomming.startRawSubPipeline, (message) => {
            this._handleStartSubPipeline(message, ApiServerPostTypes.SubPipeline.RAW);
        });

        // handle 'startStoredSubPipeline' from algorithm
        algoRunnerCommunication.on(messages.incomming.startStoredSubPipeline, (message) => {
            this._handleStartSubPipeline(message, ApiServerPostTypes.SubPipeline.STORED);
        });

        // handle 'stopSubPipeline' from algorithm
        algoRunnerCommunication.on(messages.incomming.stopSubPipeline, (message) => {
            this._handleStopSubPipeline(message);
        });
    }

    /**
     * Delete jobId/subPipelineId mapping and unwatch subpipeline job results.
     * @param {object} result
     * @returns {string} alg subPipelineId (correlates to result.jobId)
     */
    _getAndCleanAlgSubPipelineId(result) {
        // clean subPipeline Id mapping
        const subPipelineId = this._jobId2InternalIdMap.get(result.jobId);
        log.info(`got subPipeline result, status=${result.status}, jobId: ${result.jobId}, alg subPipelineId: ${subPipelineId}`, { component });
        if (!subPipelineId) {
            log.warning(`got result with unknown jobId: ${result.jobId}`, { component });
        }
        this._jobId2InternalIdMap.delete(result.jobId);
        // unwatch subPipeline job results
        this.unwatchJobResults(result.jobId);

        return subPipelineId;
    }

    /**
     * Unwatch subPipeline job results
     * @param {string} subPipelineJobId
     */
    async unwatchJobResults(subPipelineJobId) {
        try {
            await discovery.unWatchJobResults({ jobId: subPipelineJobId });
        }
        catch (error) {
            log.warning(`error during unWatchJobResults for jobId: ${subPipelineJobId}: ${error.message}`, { component });
        }
    }

    /**
     * Ensure worker is in 'working' state
     * @param {string} operation operation for which this validation is requested
     * @returns true if in 'working' state, else false
     */
    _validateWorkingState(operation) {
        if (stateManager.state === workerStates.working) {
            return true;
        }
        const err = `cannot ${operation} while in ${stateManager.state} state`;
        log.warning(err, { component });
        return false;
    }

    /**
     * Handle subPipeline completed
     * @param {object} result
     * @param {string} subPipelineId
     */
    async _handleSubPipelineCompleted(result, subPipelineId) {
        log.info(`SubPipeline job completed, alg subPipelineId: ${subPipelineId}`, { component });
        this._finishSubPipelineSpan(subPipelineId, result.status);
        if (!this._validateWorkingState('send subPipelineDone')) {
            return;
        }
        // get subpipeline results from storage
        const res = await storageManager.get(result.data.storageInfo);
        if (res.error) {
            this._handleJobError(res.error.message, subPipelineId);
            return;
        }

        // send subPipelineDone to alg
        algoRunnerCommunication.send({
            command: messages.outgoing.subPipelineDone,
            data: {
                response: res,
                subPipelineId
            }
        });
    }

    /**
     * Handle subPipeline stopped
     * @param {object} result
     * @param {string} subPipelineId
     */
    _handleSubPipelineStopped(result, subPipelineId) {
        log.warning(`SubPipeline job stopped - send subPipelineStopped to alg, alg subPipelineId: ${subPipelineId} `, { component });
        this._finishSubPipelineSpan(subPipelineId, result.status, result.reason);
        if (!this._validateWorkingState('send subPipelineStopped')) {
            return;
        }
        algoRunnerCommunication.send({
            command: messages.outgoing.subPipelineStopped,
            data: {
                subPipelineId
            }
        });
    }

    /**
     * Handle subPipeline job error
     * @param {string} error error message
     * @param {string} subPipelineId internal algorothm subpipeline Id
     */
    async _handleJobError(error, subPipelineId) {
        log.error(`SubPipeline job error: ${error}, alg subPipelineId: ${subPipelineId}`, { component });
        algoRunnerCommunication.send({
            command: messages.outgoing.subPipelineError,
            data: {
                subPipelineId,
                error
            }
        });
    }

    /**
     * Handle algorithm request to stop a sub pipeline.
     * @param {object} message
     */
    _handleStopSubPipeline(message) {
        const data = message && message.data;
        const subPipelineId = data && data.subPipelineId;
        const subPipelineJobId = this.getSubPipelineJobId(subPipelineId);
        log.info(`got stopSubPipeline for alg subPipelineId ${subPipelineId} - subPipeline jobId: ${subPipelineJobId}`, { component });
        if (!this._validateWorkingState('stop subPipeline')) {
            return;
        }
        if (!subPipelineJobId) {
            log.warning(`ignore stopSubPipeline: alg subPipelineId ${subPipelineId} not found`, { component });
            this._handleJobError(`cannot stop subPipeline - not found: ${subPipelineId}`, subPipelineId);
            return;
        }
        const reason = `stopped by algorithm: ${data && data.reason}`;
        this._stopSubPipeline(subPipelineJobId, reason);
    }

    /**
     * finish subPipeline span
     * @param subPipelineId
     * @param status subPieline status when finished
     * @param error for status=FAILED: error object or message, for status=STOP: stop reason
     */
    async _finishSubPipelineSpan(subPipelineId, status, error) {
        const topSpan = tracer.topSpan(subPipelineId);
        if (topSpan) {
            topSpan.addTag({ status });
            if (status === Status.STOPPED) {
                topSpan.addTag({ reason: error });
                await topSpan.finish();
            }
            else {
                await topSpan.finish(error);
            }
        }
    }

    /**
     * Handle algorithm request to start a sub pipeline.
     * @param {object} message message
     * @param {string} subPipelineType
     */
    async _handleStartSubPipeline(message, subPipelineType) {
        const data = message && message.data;
        const subPipeline = data && data.subPipeline;
        const subPipelineId = data && data.subPipelineId;
        log.info(`got startSubPipeline ${subPipeline.name} from algorithm`, { component });
        if (!this._validateWorkingState('start subPipeline')) {
            return;
        }
        if (!subPipeline) {
            this._handleJobError("bad 'startSubPipeline' message: 'subPipeline' object is missing", subPipelineId);
            return;
        }
        if (!subPipelineId) {
            this._handleJobError("bad 'startSubPipeline' message: 'subPipelineId' is missing", subPipelineId);
            return;
        }

        // send subPipelineStarted to alg
        algoRunnerCommunication.send({
            command: messages.outgoing.subPipelineStarted,
            data: {
                subPipelineId
            }
        });

        // post subPipeline
        try {
            const { jobId, taskId } = jobConsumer;
            const subPipelineToPost = { ...subPipeline, jobId, taskId }; // add jobId, taskId
            const response = await apiServerClient.postSubPipeline(subPipelineToPost, subPipelineType);
            if (response) {
                const subPipelineJobId = response.jobId;
                // map jobId/subPipelineId
                this._jobId2InternalIdMap.set(subPipelineJobId, subPipelineId);
                log.info(`SubPipeline posted, alg subPipelineId=${subPipelineId}, jobId=${subPipelineJobId}`, { component });

                // start subPipeline span
                const name = `${jobConsumer.getAlgorithmType()}:  start-subpipeline ${subPipeline.name}`;
                const topSpan = tracer.topSpan(jobConsumer.taskId);
                const spanOptions = {
                    name,
                    id: subPipelineId,
                    tags: {
                        subPipelineJobId,
                        subPipelineId,
                        jobId: jobConsumer.jobId,
                        taskId: jobConsumer.taskId,
                    }
                };
                if (topSpan) {
                    spanOptions.parent = topSpan.context();
                }
                tracer.startSpan(spanOptions);
                // watch results
                const result = await discovery.watchJobResults({ jobId: subPipelineJobId });
                if (result) {
                    log.info(`got immediate results, status=${result.status}, jobId: ${subPipelineJobId}`, { component });
                    const algSubPipelineId = this._getAndCleanAlgSubPipelineId({ ...result, jobId: subPipelineJobId });
                    if (result.status === Status.COMPLETED) {
                        this._handleSubPipelineCompleted(result, algSubPipelineId);
                    }
                    else if (result.status === Status.STOPPED) {
                        this._handleSubPipelineStopped(result, algSubPipelineId);
                    }
                    else {
                        const err = (result.error || 'subpipeline job failed');
                        this._finishSubPipelineSpan(subPipelineId, Status.FAILED, err);
                        this._handleJobError(err, algSubPipelineId);
                    }
                }
            }
            else {
                throw new Error('post subPipeline got no response');
            }
        }
        catch (error) {
            this._handleJobError(error.message, subPipelineId);
        }
    }

    /**
     * Stop a single subPipeline
     * @param {string} subPipelineJobId
     * @param {string} reason
     */
    async _stopSubPipeline(subPipelineJobId, reason) {
        log.info(`stopping subPipeline  ${subPipelineJobId} - reason: ${reason} ...`);
        try {
            this.unwatchJobResults(subPipelineJobId);
            await apiServerClient.postStopSubPipeline(subPipelineJobId, reason);
        }
        catch (error) {
            log.warning(`failed to post stop request for subPipeline ${subPipelineJobId}: ${error.message}`, { component });
        }
    }

    /**
     * Stop all active subPipelinese
     * @param reason
     */
    stopAllSubPipelines(reason) {
        if (this._jobId2InternalIdMap.size === 0) {
            log.info('no registered subPipelines to stop', { component });
            return;
        }
        // stop all subPipelines
        log.info(`stopping ${this._jobId2InternalIdMap.size} registered subPipelines, reason: ${reason} ...`, { component });
        this._jobId2InternalIdMap.forEach((subPipelineId, subPipelineJobId) => {
            this._stopSubPipeline(subPipelineJobId, reason);
            // finish subPipeline span
            this._finishSubPipelineSpan(subPipelineId, Status.STOPPED, reason);
        });
        // clean subPipelines IDs
        this._jobId2InternalIdMap.clear();
    }

    /**
     * Get subPipeline jobId by alg subPipelineId
     * @param {*} algSubPipelineId
     */
    getSubPipelineJobId(algSubPipelineId) {
        const jobId = ([...this._jobId2InternalIdMap].find(([, v]) => v === algSubPipelineId) || [])[0];
        return jobId;
    }
}

module.exports = new SubPipelineHandler();
