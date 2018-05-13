const request = require('requestretry');
const stateManager = require('../state/state-manager');
const storageFactory = require('../datastore/storage-factory');
const log = require('@hkube/logger').GetLogFromContainer();
const components = require('../../common/consts/componentNames');
const levels = require('../progress/progressLevels');
const States = require('./States');
const { metrics, utils } = require('@hkube/metrics');
const { metricsNames } = require('../../common/consts/metricsNames');

class WebhooksHandler {
    init(options) {
        this._options = options;
        metrics.addTimeMeasure({
            name: metricsNames.pipelines_gross,
            labels: ['pipeline_name', 'status'],
            buckets: utils.arithmatcSequence(30, 0, 2)
                .concat(utils.geometricSequence(10, 56, 2, 1).slice(2)).map(i => i * 1000)
        });
        this._recovery();
        this._watch();
    }

    _watch() {
        stateManager.on('job-result', async (response) => {
            this._requestResults({ jobId: response.jobId, ...response });
            const payloadData = await storageFactory.getResults(response);
            const pipeline = await stateManager.getExecution({ jobId: payloadData.jobId });
            // trigger call should be from Trigger Service (testing only)
            if (payloadData.data && pipeline.triggers && pipeline.triggers.pipelines) {
                const flowInput = payloadData.data.map(r => r.result);
                pipeline.triggers.pipelines.forEach((p) => {
                    request({
                        method: 'POST',
                        uri: 'http://localhost:3000/internal/v1/exec/stored',
                        body: {
                            name: p,
                            parentJobId: payloadData.jobId,
                            flowInput
                        },
                        json: true
                    }).then(() => {
                    }).catch(() => {
                    });
                });
            }
        });

        stateManager.on('job-status', (results) => {
            this._requestStatus({ jobId: results.jobId, ...results });
        });
    }

    async _recovery() {
        const jobResults = await stateManager.getCompletedJobs();
        jobResults.forEach((job) => {
            if ((!job.webhooks) || (job.webhooks && job.webhooks.pipelineStatus !== job.result.status)) {
                this._requestResults({ jobId: job.jobId, ...job.result });
            }
            if ((!job.webhooks) || (job.webhooks && job.webhooks.pipelineStatus !== job.status.status)) {
                this._requestStatus({ jobId: job.jobId, ...job.status });
            }
        });
    }

    async _requestStatus(payload) {
        const pipeline = await stateManager.getExecution({ jobId: payload.jobId });
        if (pipeline.webhooks && pipeline.webhooks.progress) {
            const clientLevel = levels[pipeline.options.progressVerbosityLevel].level;
            const pipelineLevel = levels[payload.level].level;
            log.debug(`progress event with ${payload.level} verbosity, client requested ${pipeline.options.progressVerbosityLevel}`, { component: components.WEBHOOK_HANDLER, jobId: payload.jobId });
            if (clientLevel <= pipelineLevel) {
                const result = await this._request(pipeline.webhooks.progress, payload, 'progress', payload.status, payload.jobId);
                stateManager.setWebhooksStatus({ jobId: payload.jobId, data: result });
            }
        }
    }

    async _requestResults(payload) {
        const pipeline = await stateManager.getExecution({ jobId: payload.jobId });
        const time = Date.now() - pipeline.startTime;
        metrics.get(metricsNames.pipelines_gross).retroactive({
            time,
            labelValues: {
                pipeline_name: pipeline.name,
                status: payload.status
            }
        });
        if (pipeline.webhooks && pipeline.webhooks.result) {
            const payloadData = await storageFactory.getResults(payload);
            const result = await this._request(pipeline.webhooks.result, payloadData, 'result', payloadData.status, payloadData.jobId);
            stateManager.setWebhooksResults({ jobId: payloadData.jobId, data: result });
        }
    }

    _request(url, body, type, pipelineStatus, jobId) {
        return new Promise((resolve) => {
            log.debug(`trying to call ${type} webhook ${url}`, { component: components.WEBHOOK_HANDLER });
            const data = {
                url,
                pipelineStatus
            };
            request({
                method: 'POST',
                uri: url,
                body,
                json: true,
                maxAttempts: this._options.webhooks.retryStrategy.maxAttempts,
                retryDelay: this._options.webhooks.retryStrategy.retryDelay,
                retryStrategy: request.RetryStrategies.HTTPOrNetworkError
            }).then((response) => {
                data.responseStatus = response.statusCode >= 400 ? States.FAILED : States.SUCCEED;
                data.httpResponse = { statusCode: response.statusCode, statusMessage: response.statusMessage };
                log.debug(`webhook ${type} completed with status ${response.statusCode} ${response.statusMessage}, attempts: ${response.attempts}`, { component: components.WEBHOOK_HANDLER, jobId });
                return resolve(data);
            }).catch((error) => {
                data.responseStatus = States.FAILED;
                data.httpResponse = { statusCode: error.code, statusMessage: error.message };
                log.warning(`webhook ${type} failed ${error.message}`, { component: components.WEBHOOK_HANDLER, jobId });
                return resolve(data);
            });
        });
    }
}

module.exports = new WebhooksHandler();
