const { expect } = require('chai');
const uuidv4 = require('uuid/v4');
const request = require('request');
const querystring = require('querystring');
const clone = require('clone');
const bootstrap = require('../bootstrap');
const stateManager = require('../lib/state/state-manager');
const storageFactory = require('../lib/datastore/storage-factory');
const { algorithms, pipelines, triggersTree, webhookStub, workerStub } = require('./mocks');
const converter = require('@hkube/units-converter');
let config;
let baseUrl;

const delay = d => new Promise(r => setTimeout(r, d));

const _request = (options) => {
    return new Promise((resolve, reject) => {
        request({
            method: options.method || 'POST',
            uri: options.uri,
            json: true,
            body: options.body
        }, (error, response, body) => {
            if (error) {
                return reject(error);
            }
            return resolve({ body, response });
        });
    });
}

describe('Rest', () => {
    before(async () => {
        config = await bootstrap.init();
        baseUrl = `${config.swagger.protocol}://${config.swagger.host}:${config.swagger.port}`;
        await Promise.all(pipelines.map(p => stateManager.setPipeline(p)));
        await Promise.all(algorithms.map(p => stateManager.setAlgorithm(p)));
        webhookStub.start();
    });
    const versions = ['v1', 'v2'];
    versions.forEach((v) => {
        describe(`Rest-API ${v}`, () => {
            let restUrl = null;
            before(() => {
                restUrl = `${baseUrl}/${config.rest.prefix}/${v}`;
            });
            describe('Execution', () => {
                describe('/exec/raw', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/raw`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'GET',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of data.name should be string', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: {}
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should be string');
                    });
                    it('should throw validation error of name should NOT be shorter than 1 characters"', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: ''
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should NOT be shorter than 1 characters');
                    });
                    it('should throw validation error of required property nodes', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string'
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'nodes'");
                    });
                    it('should throw validation error of required property nodes.nodeName', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        algorithmName: 'green-alg',
                                        input: [
                                            {}
                                        ]
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.nodes[0] should have required property 'nodeName'");
                    });
                    it('should throw validation error of required property nodes.algorithmName', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        input: [
                                            {}
                                        ]
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.nodes[0] should have required property 'algorithmName'");
                    });
                    it('should throw validation error of nodes.input should be array', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: null
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                    });
                    it('should throw validation error of data should NOT have additional properties', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                additionalProps: {
                                    bla: 60,
                                    blabla: 'info'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data should NOT have additional properties');
                    });
                    it('should throw validation error of duplicate node', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'dup',
                                        algorithmName: 'green-alg',
                                        input: []
                                    },
                                    {
                                        nodeName: 'dup',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('found duplicate node dup');
                    });
                    it('should throw validation error priority range', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'dup',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                priority: 8
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.priority should be <= 5');
                    });
                    it('should throw validation error pipeline name', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'exec/raw',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('pipeline name must contain only alphanumeric, dash, dot or underscore');
                    });
                    it('should succeed and return job id', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'exec_raw',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('jobId');
                    });
                });
                describe('/exec/stored', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/stored`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'GET',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of data.name should be string', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: {}
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should be string');
                    });
                    it('should throw validation error of name should NOT be shorter than 1 characters"', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: ''
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should NOT be shorter than 1 characters');
                    });
                    it('should throw validation error of data should NOT have additional properties', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data should NOT have additional properties');
                    });
                    it('should throw pipeline not found', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'not_found'
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('pipeline not_found Not Found');
                    });
                    it('should throw validation error pipeline name', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'exec/stored'
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('pipeline name must contain only alphanumeric, dash, dot or underscore');
                    });
                    it('should succeed and return job id', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'flow1'
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('jobId');
                    });
                });
                describe('/exec/stop', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/stop`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'GET',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw validation error of required property jobId', async () => {
                        const options = {
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'jobId'");
                    });
                    it('should throw validation error of data.name should be string', async () => {
                        const options = {
                            uri: restPath,
                            body: { jobId: 'no_such_id' }
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('jobId no_such_id Not Found');
                    });
                    it('should succeed to stop', async () => {
                        const optionsStored = {
                            uri: restUrl + '/exec/stored',
                            body: { name: 'flow1' }
                        };
                        const stored = await _request(optionsStored);
                        const optionsStop = {
                            uri: restPath,
                            body: { jobId: stored.body.jobId }
                        };
                        const response = await _request(optionsStop);
                        expect(response.body).to.have.property('message');
                        expect(response.body.message).to.equal('OK');
                    });
                });
                describe('/exec/status', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/status`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('status no_such_id Not Found');
                    });
                    it('should throw validation error of required property execution id', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'jobId'");
                    });
                    it('should succeed to get status', async () => {
                        const optionsRun = {
                            method: 'POST',
                            uri: restUrl + '/exec/stored',
                            body: {
                                name: 'flow1'
                            }
                        };
                        const responseRun = await _request(optionsRun);
                        const options = {
                            uri: restPath + `/${responseRun.body.jobId}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(200);
                        expect(response.body).to.have.property('jobId');
                        expect(response.body).to.have.property('level');
                        expect(response.body).to.have.property('pipeline');
                        expect(response.body).to.have.property('status');
                        expect(response.body).to.have.property('timestamp');
                    });
                });
                describe('/exec/results', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/results`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('status no_such_id Not Found');
                    });
                    it('should throw validation error of required property execution id', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'jobId'");
                    });
                    it('should succeed to get results', async () => {
                        const optionsRun = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'exec_raw_results',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const responseRun = await _request(optionsRun);
                        const jobId = responseRun.body.jobId;
                        const taskId = responseRun.body.jobId;
                        const data = 500;
                        await workerStub.done({ jobId, data });

                        const options = {
                            uri: restPath + `/${responseRun.body.jobId}`,
                            method: 'GET'
                        };
                        const response = await _request(options);

                        expect(response.response.statusCode).to.equal(200);
                        expect(response.body.data).to.equal(data);
                        expect(response.body).to.have.property('jobId');
                        expect(response.body).to.have.property('data');
                        expect(response.body).to.have.property('storageModule');
                        expect(response.body).to.have.property('status');
                        expect(response.body).to.have.property('timeTook');
                        expect(response.body).to.have.property('timestamp');
                    });
                });
                describe('/exec/pipelines/results/stored', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/pipelines/results/stored`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('pipeline results no_such_id Not Found');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of order property', async () => {
                        const qs = querystring.stringify({ order: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.order should be equal to one of the allowed values");
                    });
                    it('should throw validation error of sort property', async () => {
                        const qs = querystring.stringify({ sort: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.sort should be equal to one of the allowed values");
                    });
                    it('should throw validation error of limit should be >= 1', async () => {
                        const qs = querystring.stringify({ limit: 0 });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be >= 1");
                    });
                    it('should throw validation error of limit should be integer', async () => {
                        const qs = querystring.stringify({ limit: "y" });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be integer");
                    });
                    it('should succeed to get pipelines results', async () => {
                        const pipeline = 'flow1';
                        const optionsRun = {
                            method: 'POST',
                            uri: restUrl + '/exec/stored',
                            body: {
                                name: pipeline
                            }
                        };
                        const data = [100, 200, 300];
                        const responses = await Promise.all(data.map(d => _request(optionsRun)));
                        await Promise.all(responses.map((r, i) => workerStub.done({ jobId: r.body.jobId, data: data[i] })));

                        const qs = querystring.stringify({ sort: 'desc', limit: 3 });
                        const options = {
                            uri: restPath + `/${pipeline}?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        const result = response.body.map(r => r.data).sort();
                        expect(response.response.statusCode).to.equal(200);
                        expect(result).to.deep.equal(data);
                        expect(response.body[0]).to.have.property('jobId');
                        expect(response.body[0]).to.have.property('data');
                        expect(response.body[0]).to.have.property('storageModule');
                        expect(response.body[0]).to.have.property('status');
                        expect(response.body[0]).to.have.property('timeTook');
                        expect(response.body[0]).to.have.property('timestamp');
                    })
                });
                describe('/exec/pipelines/results/raw', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/pipelines/results/raw`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('pipeline results no_such_id Not Found');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of order property', async () => {
                        const qs = querystring.stringify({ order: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.order should be equal to one of the allowed values");
                    });
                    it('should throw validation error of sort property', async () => {
                        const qs = querystring.stringify({ sort: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.sort should be equal to one of the allowed values");
                    });
                    it('should throw validation error of limit should be >= 1', async () => {
                        const qs = querystring.stringify({ limit: 0 });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be >= 1");
                    });
                    it('should throw validation error of limit should be integer', async () => {
                        const qs = querystring.stringify({ limit: "y" });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be integer");
                    });
                    it('should succeed to get pipelines results', async () => {
                        const pipeline = 'flow1';
                        const optionsRun = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: pipeline,
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const data = [100, 200, 300];
                        const responses = await Promise.all(data.map(d => _request(optionsRun)));
                        await Promise.all(responses.map((r, i) => workerStub.done({ jobId: r.body.jobId, data: data[i] })));

                        const qs = querystring.stringify({ sort: 'desc', limit: 3 });
                        const options = {
                            uri: restPath + `/${pipeline}?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        const result = response.body.map(r => r.data).sort();
                        expect(response.response.statusCode).to.equal(200);
                        expect(result).to.deep.equal(data);
                        expect(response.body[0]).to.have.property('jobId');
                        expect(response.body[0]).to.have.property('data');
                        expect(response.body[0]).to.have.property('storageModule');
                        expect(response.body[0]).to.have.property('status');
                        expect(response.body[0]).to.have.property('timeTook');
                        expect(response.body[0]).to.have.property('timestamp');
                    })
                });
                describe('/exec/pipelines/status/stored', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/pipelines/status/stored`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('pipeline status no_such_id Not Found');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of order property', async () => {
                        const qs = querystring.stringify({ order: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.order should be equal to one of the allowed values");
                    });
                    it('should throw validation error of sort property', async () => {
                        const qs = querystring.stringify({ sort: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.sort should be equal to one of the allowed values");
                    });
                    it('should throw validation error of limit should be >= 1', async () => {
                        const qs = querystring.stringify({ limit: 0 });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be >= 1");
                    });
                    it('should throw validation error of limit should be integer', async () => {
                        const qs = querystring.stringify({ limit: "y" });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be integer");
                    });
                    it('should succeed to get pipelines status', async () => {
                        const pipeline = 'flow1';
                        const optionsRun = {
                            method: 'POST',
                            uri: restUrl + '/exec/stored',
                            body: {
                                name: pipeline
                            }
                        };
                        const limit = 3;
                        await Promise.all(Array.from(Array(limit)).map(d => _request(optionsRun)));

                        const qs = querystring.stringify({ sort: 'desc', limit });
                        const options = {
                            uri: restPath + `/${pipeline}?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(200);
                        expect(response.body).to.have.lengthOf(limit)
                        expect(response.body[0]).to.have.property('jobId');
                        expect(response.body[0]).to.have.property('level');
                        expect(response.body[0]).to.have.property('pipeline');
                        expect(response.body[0]).to.have.property('status');
                        expect(response.body[0]).to.have.property('timestamp');
                    })
                });
                describe('/exec/pipelines/status/raw', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/pipelines/status/raw`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('pipeline status no_such_id Not Found');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of order property', async () => {
                        const qs = querystring.stringify({ order: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.order should be equal to one of the allowed values");
                    });
                    it('should throw validation error of sort property', async () => {
                        const qs = querystring.stringify({ sort: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.sort should be equal to one of the allowed values");
                    });
                    it('should throw validation error of limit should be >= 1', async () => {
                        const qs = querystring.stringify({ limit: 0 });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be >= 1");
                    });
                    it('should throw validation error of limit should be integer', async () => {
                        const qs = querystring.stringify({ limit: "y" });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be integer");
                    });
                    it('should succeed to get pipelines results', async () => {
                        const pipeline = 'flow1';
                        const optionsRun = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: pipeline,
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const limit = 3;
                        await Promise.all(Array.from(Array(limit)).map(d => _request(optionsRun)));

                        const qs = querystring.stringify({ sort: 'desc', limit });
                        const options = {
                            uri: restPath + `/${pipeline}?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(200);
                        expect(response.body).to.have.lengthOf(limit)
                        expect(response.body[0]).to.have.property('jobId');
                        expect(response.body[0]).to.have.property('level');
                        expect(response.body[0]).to.have.property('pipeline');
                        expect(response.body[0]).to.have.property('status');
                        expect(response.body[0]).to.have.property('timestamp');
                    })
                });
                describe('/exec/cron/results', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/cron/results`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('cron results no_such_id Not Found');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of order property', async () => {
                        const qs = querystring.stringify({ order: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.order should be equal to one of the allowed values");
                    });
                    it('should throw validation error of sort property', async () => {
                        const qs = querystring.stringify({ sort: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.sort should be equal to one of the allowed values");
                    });
                    it('should throw validation error of limit should be >= 1', async () => {
                        const qs = querystring.stringify({ limit: 0 });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be >= 1");
                    });
                    it('should throw validation error of limit should be integer', async () => {
                        const qs = querystring.stringify({ limit: "y" });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be integer");
                    });
                    it('should succeed to get cron results', async () => {
                        const pipeline = 'flow1';
                        const optionsRun = {
                            method: 'POST',
                            uri: `${baseUrl}/internal/v1/exec/stored`,
                            body: {
                                name: pipeline
                            }
                        };
                        const data = [100, 200, 300];
                        const responses = await Promise.all(data.map(d => _request(optionsRun)));
                        await Promise.all(responses.map((r, i) => workerStub.done({ jobId: r.body.jobId, data: data[i] })));

                        const qs = querystring.stringify({ sort: 'desc', limit: 3 });
                        const options = {
                            uri: restPath + `/${pipeline}?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        const result = response.body.map(r => r.data).sort();
                        expect(response.response.statusCode).to.equal(200);
                        expect(result).to.deep.equal(data);
                        expect(response.body[0]).to.have.property('jobId');
                        expect(response.body[0]).to.have.property('data');
                        expect(response.body[0]).to.have.property('storageModule');
                        expect(response.body[0]).to.have.property('status');
                        expect(response.body[0]).to.have.property('timeTook');
                        expect(response.body[0]).to.have.property('timestamp');
                    })
                });
                describe('/exec/cron/status', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/cron/status`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw status Not Found with params', async () => {
                        const options = {
                            uri: restPath + '/no_such_id',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('cron status no_such_id Not Found');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of order property', async () => {
                        const qs = querystring.stringify({ order: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.order should be equal to one of the allowed values");
                    });
                    it('should throw validation error of sort property', async () => {
                        const qs = querystring.stringify({ sort: 'bla' });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.sort should be equal to one of the allowed values");
                    });
                    it('should throw validation error of limit should be >= 1', async () => {
                        const qs = querystring.stringify({ limit: 0 });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be >= 1");
                    });
                    it('should throw validation error of limit should be integer', async () => {
                        const qs = querystring.stringify({ limit: "y" });
                        const options = {
                            uri: restPath + `/pipe?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.limit should be integer");
                    });
                    it('should succeed to get cron status', async () => {
                        const pipeline = 'flow1';
                        const optionsRun = {
                            method: 'POST',
                            uri: `${baseUrl}/internal/v1/exec/stored`,
                            body: {
                                name: pipeline
                            }
                        };
                        const limit = 3;
                        await Promise.all(Array.from(Array(limit)).map(d => _request(optionsRun)));

                        const qs = querystring.stringify({ sort: 'desc', limit });
                        const options = {
                            uri: restPath + `/${pipeline}?${qs}`,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(200);
                        expect(response.body[0]).to.have.property('jobId');
                        expect(response.body[0]).to.have.property('level');
                        expect(response.body[0]).to.have.property('pipeline');
                        expect(response.body[0]).to.have.property('status');
                        expect(response.body[0]).to.have.property('timestamp');
                    })
                });
                describe('/exec/tree', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/tree`;
                    });
                    it('pipeline call stack by trigger', async () => {
                        let prefix = '57ec5c39-122b-4d7c-bc8f-580ba30df511';
                        await Promise.all([
                            stateManager.setExecution({ jobId: prefix + '.a', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.e', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.e.f', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.g', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.i', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h.j.k.l', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h.j.k.o', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h.j.k.p', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.b.m', data: { startTime: Date.now() } }),
                            stateManager.setExecution({ jobId: prefix + '.a.n', data: { startTime: Date.now() } })
                        ]);

                        const options = {
                            method: 'GET',
                            uri: restPath + `/${prefix}.a`
                        };
                        const response = await _request(options);
                        expect(response.body).to.deep.equal(triggersTree);
                    });
                    it('should failed if jobId not found', async () => {
                        const options = {
                            method: 'GET',
                            uri: restPath + `/${uuidv4()}`
                        };
                        const response = await _request(options);
                        expect(response.response.statusCode).to.deep.equal(404);
                    });
                });
                describe('/exec/pipeline', () => {
                    let restPath = null;
                    before(() => {
                        restPath = `${restUrl}/exec/pipeline`;
                    });
                    it('should throw Method Not Allowed', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath + '/job',
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(405);
                        expect(response.body.error.message).to.equal('Method Not Allowed');
                    });
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            method: 'GET',
                            uri: restPath + '/not_exists',
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal("pipeline not_exists Not Found");
                    });
                    it('should throw validation error if algorithmName not exists', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'exec_pipeline',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'dummy',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal("algorithm dummy Not Found");
                    });
                    it('should succeed and return job id', async () => {
                        const options1 = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'exec_pipeline',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response1 = await _request(options1);
                        const options = {
                            method: 'GET',
                            uri: restPath + '/' + response1.body.jobId,
                        };
                        const response2 = await _request(options);
                        expect(response2.body).to.have.property('name');
                        expect(response2.body).to.have.property('nodes');
                        expect(response2.body).to.have.property('options');
                        expect(response2.body).to.have.property('priority');
                        expect(response2.body).to.have.property('startTime');
                        expect(response2.body.name).to.have.string(options1.body.name);
                        expect(response2.body.nodes).to.deep.equal(options1.body.nodes);
                    });
                });
            });
            describe('Store/Algorithms', () => {
                let restPath = null;
                before(() => {
                    restPath = `${restUrl}/store/algorithms`;
                });
                describe('/store/algorithms:name GET', () => {
                    it('should throw error algorithm not found', async () => {
                        const options = {
                            uri: restPath + '/not_exists',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('algorithm not_exists Not Found');
                    });
                    it('should return specific algorithm', async () => {
                        const body = {
                            "name": "test-alg",
                            "algorithmImage": "hkube/algorithm-example",
                            "cpu": 1,
                            "mem": "5000Ki"
                        };
                        const options = {
                            uri: restPath,
                            method: 'POST',
                            body
                        };
                        await _request(options);

                        const getOptions = {
                            uri: restPath + '/test-alg',
                            method: 'GET'
                        };
                        const response = await _request(getOptions);
                        body.mem = converter.getMemoryInMi(body.mem);
                        expect(response.body.mem).to.equal(body.mem);
                    });
                });
                describe('/store/algorithms:name DELETE', () => {
                    it('should throw error algorithm not found', async () => {
                        const options = {
                            uri: restPath + '/not_exists',
                            method: 'DELETE',
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('algorithm not_exists Not Found');
                    });
                    xit('should delete specific algorithm', async () => {
                        const optionsInsert = {
                            uri: restPath,
                            method: 'POST',
                            body: {
                                name: "delete",
                                algorithmImage: "image"
                            }
                        };
                        await _request(optionsInsert);

                        const options = {
                            uri: restPath + '/delete',
                            method: 'DELETE',
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('message');
                        expect(response.body.message).to.equal('OK');
                    });
                });
                describe('/store/algorithms GET', () => {
                    it('should throw validation error of required property jobId', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body).to.be.an('array');
                    });
                });
                describe('/store/algorithms POST', () => {
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of data.name should be string', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: {}
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should be string');
                    });
                    it('should throw validation error of memory min 4 Mi', async () => {
                        const body = {
                            name: uuidv4(),
                            algorithmImage: "image",
                            mem: "3900Ki",
                            cpu: 1
                        }
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('memory must be at least 4 Mi');
                    });
                    it('should throw validation error of name should NOT be shorter than 1 characters"', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: ''
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should NOT be shorter than 1 characters');
                    });
                    it('should throw conflict error', async () => {
                        const options = {
                            uri: restPath,
                            method: 'POST',
                            body: {
                                name: "conflict",
                                algorithmImage: "image"
                            }
                        };
                        await _request(options);
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(409);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.message).to.equal('algorithm conflict already exists');
                    });
                    it('should throw invalid algorithm name', async () => {
                        const options = {
                            uri: restPath,
                            method: 'POST',
                            body: {
                                name: "not_valid/name",
                                algorithmImage: "image"
                            }
                        };
                        await _request(options);
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.response.statusCode).to.equal(400);
                        expect(response.body.error.message).to.equal('algorithm name must contain only alphanumeric, dash or dot');
                    });
                    it('should succeed to store algorithm', async () => {
                        const body = {
                            name: uuidv4(),
                            algorithmImage: "image",
                            mem: "50Mi",
                            cpu: 1
                        }
                        const options = {
                            uri: restPath,
                            method: 'POST',
                            body
                        };
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(201);
                        body.mem = converter.getMemoryInMi(body.mem);
                        expect(response.body).to.deep.equal(body);
                    });
                });
                describe('/store/algorithms PUT', () => {
                    it('should throw validation error of memory min 4 Mi', async () => {
                        const body = Object.assign({}, algorithms[0]);
                        body.mem = '3900Ki';
                        const options = {
                            method: 'PUT',
                            uri: restPath,
                            body
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('memory must be at least 4 Mi');
                    });
                    it('should succeed to update algorithm', async () => {
                        const body = Object.assign({}, algorithms[0]);
                        const options = {
                            uri: restPath,
                            method: 'PUT',
                            body
                        };
                        const response = await _request(options);
                        body.mem = converter.getMemoryInMi(body.mem);
                        expect(response.body).to.deep.equal(body);
                    });
                });
            });
            describe('Store/Pipelines', () => {
                let restPath = null;
                before(() => {
                    restPath = `${restUrl}/store/pipelines`;
                });
                describe('/store/pipelines:name GET', () => {
                    it('should throw error pipeline not found', async () => {
                        const options = {
                            uri: restPath + '/not_exists',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('pipeline not_exists Not Found');
                    });
                    it('should return specific pipeline', async () => {
                        const options = {
                            uri: restPath + '/flow1',
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body).to.deep.equal(pipelines[0]);
                    });
                });
                describe('/store/pipelines:name DELETE', () => {
                    it('should throw error pipeline not found', async () => {
                        const options = {
                            uri: restPath + '/not_exists',
                            method: 'DELETE',
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('pipeline not_exists Not Found');
                    });
                    it('should delete specific pipeline', async () => {
                        const pipeline = clone(pipelines[0]);
                        const optionsInsert = {
                            uri: restPath,
                            method: 'POST',
                            body: pipeline
                        };
                        await _request(optionsInsert);

                        const options = {
                            uri: restPath + '/' + pipeline.name,
                            method: 'DELETE',
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('message');
                        expect(response.body.message).to.equal('OK');
                    });
                });
                describe('/store/pipelines GET', () => {
                    it('should get all pipelines', async () => {
                        const options = {
                            uri: restPath,
                            method: 'GET'
                        };
                        const response = await _request(options);
                        expect(response.body).to.be.an('array');
                    });
                });
                describe('/store/pipelines POST', () => {
                    it('should throw validation error of required property name', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {}
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'name'");
                    });
                    it('should throw validation error of data.name should be string', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: {}
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should be string');
                    });
                    it('should throw validation error of name should NOT be shorter than 1 characters"', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: ''
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.name should NOT be shorter than 1 characters');
                    });
                    it('should throw validation error of required property nodes', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string'
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data should have required property 'nodes'");
                    });
                    it('should throw validation error of required property nodes.nodeName', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        algorithmName: 'green-alg',
                                        input: [
                                            {}
                                        ]
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.nodes[0] should have required property 'nodeName'");
                    });
                    it('should throw validation error of cron trigger', async () => {
                        const pipeline = clone(pipelines[0]);
                        pipeline.triggers = {
                            cron: "bla"
                        }
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: pipeline
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.triggers.cron should match format "cron"');
                    });
                    it('should throw validation error of pipelines trigger should be array', async () => {
                        const pipeline = clone(pipelines[0]);
                        pipeline.triggers = {
                            pipelines: 1
                        }
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: pipeline
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.triggers.pipelines should be array');
                    });
                    it('should throw validation error of pipelines trigger should NOT be shorter than 1 characters', async () => {
                        const pipeline = clone(pipelines[0]);
                        pipeline.triggers = {
                            pipelines: [""]
                        };
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: pipeline
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.triggers.pipelines[0] should NOT be shorter than 1 characters');
                    });
                    it('should throw validation error of required property nodes.algorithmName', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        input: [
                                            {}
                                        ]
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal("data.nodes[0] should have required property 'algorithmName'");
                    });
                    it('should throw validation error of nodes.input should be array', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: null
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                    });
                    it('should throw validation error of data should NOT have additional properties', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                additionalProps: {
                                    bla: 60,
                                    blabla: 'info'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data should NOT have additional properties');
                    });
                    it('should throw conflict error', async () => {
                        const pipeline = clone(pipelines[0]);
                        pipeline.name = 'flow1';
                        const options = {
                            uri: restPath,
                            method: 'POST',
                            body: pipeline
                        };
                        await _request(options);
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(409);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.message).to.equal('pipeline flow1 already exists');
                    });
                    it('should throw validation error of duplicate node', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'dup',
                                        algorithmName: 'green-alg',
                                        input: []
                                    },
                                    {
                                        nodeName: 'dup',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('found duplicate node dup');
                    });
                    it('should throw validation error of invalid reserved name flowInput', async () => {
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: {
                                name: 'reservedName',
                                nodes: [
                                    {
                                        nodeName: 'flowInput',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ]
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('pipeline reservedName has invalid reserved name flowInput');
                    });
                    it('should throw validation error of node depend on not exists node', async () => {
                        const pipeline = pipelines.find(p => p.name === 'NodeNotExists');
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: pipeline
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('node B is depend on C which is not exists');
                    });
                    it('should throw validation error of cyclic nodes', async () => {
                        const pipeline = pipelines.find(p => p.name === 'cyclicNodes');
                        const options = {
                            method: 'POST',
                            uri: restPath,
                            body: pipeline
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('pipeline cyclicNodes has cyclic nodes');
                    });
                    it('should throw validation error of flowInput not exist', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'flowInputPipeline',
                                nodes: [
                                    {
                                        nodeName: 'A',
                                        algorithmName: 'green-alg',
                                        input: ['@flowInput.notExist']
                                    }
                                ],
                                flowInput: {}
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('unable to find flowInput.notExist');
                    });
                    it('should throw validation error if algorithmName not exists', async () => {
                        const pipeline = clone(pipelines[0]);
                        pipeline.nodes[0].algorithmName = 'not.exists'
                        pipeline.name = uuidv4();
                        const body = pipeline;
                        const options = {
                            uri: restPath,
                            method: 'POST',
                            body
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('algorithm not.exists Not Found');
                    });
                    it('should succeed to store pipeline', async () => {
                        const pipeline = clone(pipelines[0]);
                        pipeline.name = uuidv4();
                        const body = pipeline;
                        const options = {
                            uri: restPath,
                            method: 'POST',
                            body
                        };
                        const response = await _request(options);
                        expect(response.response.statusCode).to.equal(201);
                        expect(response.body).to.deep.equal(body);
                    });
                });
                describe('/store/pipelines PUT', () => {
                    it('should succeed to update pipeline', async () => {
                        const body = pipelines[0];
                        const options = {
                            uri: restPath,
                            method: 'PUT',
                            body
                        };
                        const response = await _request(options);
                        expect(response.body).to.deep.equal(body);
                    });
                    it('should throw validation error if algorithmName not exists', async () => {
                        const pipeline = clone(pipelines[0]);
                        pipeline.nodes[0].algorithmName = 'not.exists'
                        const body = pipeline;
                        const options = {
                            uri: restPath,
                            method: 'PUT',
                            body
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(404);
                        expect(response.body.error.message).to.equal('algorithm not.exists Not Found');
                    });
                });
            });
            describe('Webhooks', () => {
                describe('Results', () => {
                    it('should succeed to send webhook', async () => {
                        return new Promise(async (resolve) => {
                            let jobId = null;
                            webhookStub.on('result', async (request) => {
                                if (request.body.jobId === jobId) {
                                    expect(request.body).to.have.property('data');
                                    expect(request.body).to.have.property('jobId');
                                    expect(request.body).to.have.property('status');
                                    expect(request.body).to.have.property('timestamp');

                                    const status = {
                                        uri: restUrl + '/exec/results/' + jobId,
                                        method: 'GET'
                                    };
                                    const responseStatus = await _request(status);
                                    expect(request.body).to.deep.equal(responseStatus.body);
                                    return resolve();
                                }
                            });
                            const stored = {
                                uri: restUrl + '/exec/stored',
                                body: { name: 'webhookFlow' }
                            };
                            const response = await _request(stored);
                            jobId = response.body.jobId;

                            const results = {
                                jobId,
                                status: 'completed',
                                level: 'info',
                                data: [{ res1: 400 }, { res2: 500 }]
                            }
                            await stateManager.setJobStatus(results);
                            let link = await storageFactory.adapter.putResults({ jobId, data: results.data })
                            results.data = {};
                            results.data.storageInfo = link;
                            await stateManager.setJobResults(results);
                        });
                    });
                    it('should throw webhooks validation error of should match format "url', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                webhooks: {
                                    result: 'not_a_url'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.webhooks.result should match format "url"');
                    });
                    it('should throw webhooks validation error of NOT have additional properties', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                webhooks: {
                                    result2: 'http://localhost'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.webhooks should NOT have additional properties');
                    });
                    it('should succeed to store pipeline with webhooks', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                webhooks: {
                                    result: 'http://localhost'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('jobId');
                    });
                    it('should succeed to send webhook and get results', async () => {
                        let options = {
                            uri: restUrl + '/exec/stored',
                            body: { name: 'webhookFlow' }
                        };
                        const response = await _request(options);
                        jobId = response.body.jobId;

                        const results = {
                            jobId,
                            status: 'completed',
                            level: 'info',
                            data: [{ res1: 400 }, { res2: 500 }]
                        }
                        await stateManager.setJobStatus(results);
                        let link = await storageFactory.adapter.putResults({ jobId, data: results.data })
                        results.data = {};
                        results.data.storageInfo = link;
                        await stateManager.setJobResults(results);

                        await delay(1000);

                        options = {
                            method: 'GET',
                            uri: restUrl + '/webhooks/results/' + jobId
                        };
                        const response2 = await _request(options);

                        expect(response2.body).to.have.property('httpResponse');
                        expect(response2.body.httpResponse).to.have.property('statusCode');
                        expect(response2.body.httpResponse).to.have.property('statusMessage');
                        expect(response2.body).to.have.property('jobId');
                        expect(response2.body).to.have.property('url');
                        expect(response2.body).to.have.property('pipelineStatus');
                        expect(response2.body).to.have.property('responseStatus');
                    });
                });
                describe('Progress', () => {
                    it('should succeed to send webhook', async () => {
                        let jobId = null;
                        webhookStub.on('progress', async (request) => {
                            if (request.body.jobId === jobId) {
                                expect(request.body).to.have.property('data');
                                expect(request.body).to.have.property('jobId');
                                expect(request.body).to.have.property('status');
                                expect(request.body).to.have.property('timestamp');

                                const status = {
                                    uri: restUrl + '/exec/status/' + jobId,
                                    method: 'GET'
                                };
                                const responseStatus = await _request(status);
                                expect(request.body).to.deep.equal(responseStatus.body);
                            }
                        });
                        const stored = {
                            uri: restUrl + '/exec/stored',
                            body: { name: 'webhookFlow' }
                        };
                        const response = await _request(stored);
                        jobId = response.body.jobId;
                    });
                    it('should throw webhooks validation error of should match format "url', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                webhooks: {
                                    progress: 'not_a_url'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.webhooks.progress should match format "url"');
                    });
                    it('should throw webhooks validation error of NOT have additional properties', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                webhooks: {
                                    progress2: 'http://localhost'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('error');
                        expect(response.body.error.code).to.equal(400);
                        expect(response.body.error.message).to.equal('data.webhooks should NOT have additional properties');
                    });
                    it('should succeed to store pipeline with webhooks', async () => {
                        const options = {
                            method: 'POST',
                            uri: restUrl + '/exec/raw',
                            body: {
                                name: 'string',
                                nodes: [
                                    {
                                        nodeName: 'string',
                                        algorithmName: 'green-alg',
                                        input: []
                                    }
                                ],
                                webhooks: {
                                    progress: 'http://localhost'
                                }
                            }
                        };
                        const response = await _request(options);
                        expect(response.body).to.have.property('jobId');
                    });
                    it('should succeed and return webhooks progress', async () => {
                        const options1 = {
                            uri: restUrl + '/exec/stored',
                            body: { name: 'webhookFlow' }
                        };
                        const response = await _request(options1);

                        await delay(1000);

                        const options2 = {
                            method: 'GET',
                            uri: restUrl + '/webhooks/status/' + response.body.jobId
                        };
                        const response2 = await _request(options2);

                        expect(response2.body).to.have.property('httpResponse');
                        expect(response2.body.httpResponse).to.have.property('statusCode');
                        expect(response2.body.httpResponse).to.have.property('statusMessage');
                        expect(response2.body).to.have.property('jobId');
                        expect(response2.body).to.have.property('url');
                        expect(response2.body).to.have.property('pipelineStatus');
                        expect(response2.body).to.have.property('responseStatus');
                    });
                });
            });
        });
    });
    describe('Rest internal', () => {
        let restUrl = null;
        let realUrl = null;
        before(() => {
            restUrl = `${baseUrl}/internal/v1`;
            realUrl = `${baseUrl}/${config.rest.prefix}/${versions[0]}`;
        });
        it('should clean the job', async () => {
            const options1 = {
                method: 'POST',
                uri: `${realUrl}/exec/raw`,
                body: {
                    name: 'clean',
                    nodes: [
                        {
                            nodeName: 'string',
                            algorithmName: 'green-alg'
                        }
                    ]
                }
            };
            const response1 = await _request(options1);
            const jobId = response1.body.jobId;

            await delay(1000);

            const options2 = {
                method: 'POST',
                uri: `${restUrl}/exec/clean`,
                body: { jobId }
            };
            const response2 = await _request(options2);
            //expect(response2.body.error.message).to.equal(`data should have required property 'name'`);
        });
        it('should throw error when invalid pipeline name', async () => {
            const options = {
                method: 'POST',
                uri: `${restUrl}/exec/stored`
            };
            const response = await _request(options);
            expect(response.body.error.message).to.equal(`data should have required property 'name'`);
        });
        it('should succeed and return job id', async () => {
            const options = {
                method: 'POST',
                uri: `${restUrl}/exec/stored`,
                body: {
                    name: 'flow1',
                    jobId: uuidv4()
                }
            };
            const response = await _request(options);
            expect(response.body).to.have.property('jobId');
        });
        it('should succeed and return job id', async () => {
            const options = {
                method: 'POST',
                uri: `${restUrl}/exec/stored`,
                body: {
                    name: 'flow1',
                    jobId: uuidv4()
                }
            };
            const response = await _request(options);
            expect(response.body).to.have.property('jobId');
        });
        it('should succeed without reaching too many request', async () => {
            const requests = 10;
            const promises = [];
            const pipeline = 'flow1';
            for (let i = 0; i < requests; i++) {
                const options = {
                    method: 'POST',
                    uri: `${restUrl}/exec/stored`,
                    body: {
                        name: pipeline,
                        jobId: uuidv4()
                    }
                };
                promises.push(_request(options));
            }
            const response = await Promise.all(promises);
            const jobs = response.map(r => r.body.jobId);
            expect(jobs).to.have.lengthOf(requests);
            expect(jobs.every(j => j.includes(pipeline))).to.equal(true);
        });
        it('should run triggered pipelines and the executions tree', async () => {
            const requests = 10;
            const pipeline = 'trigger-test';
            const results = [];

            // insert 10 triggered pipelines
            for (let i = 1; i < requests; i++) {
                const body = {
                    name: `${pipeline}-${i}`,
                    nodes: [
                        {
                            "nodeName": "green",
                            "algorithmName": "green-alg",
                            "input": [
                                "@flowInput"
                            ]
                        }
                    ],
                    flowInput: {
                        "files": {
                            "link": "links-1"
                        }
                    },
                    triggers: {
                        pipelines: [
                            `${pipeline}-${(i + 1)}`
                        ]
                    }
                }
                const options = {
                    uri: realUrl + '/store/pipelines',
                    method: 'POST',
                    body
                };
                await _request(options);
            }

            // run the first pipeline
            const options = {
                method: 'POST',
                uri: `${realUrl}/exec/stored`,
                body: {
                    name: `${pipeline}-${1}`
                }
            };

            const response = await _request(options);
            const firstJobId = response.body.jobId;
            let jobId = response.body.jobId
            results.push(jobId);

            // run the rest of the triggered pipelines
            for (let i = 1; i < requests; i++) {
                const name = `${pipeline}-${(i + 1)}`;
                const options = {
                    method: 'POST',
                    uri: `${restUrl}/exec/stored`,
                    body: {
                        name,
                        jobId
                    }
                };
                const res = await _request(options);
                jobId = res.body.jobId
                results.push(jobId);
            }

            // get the exec tree
            const opt = {
                uri: realUrl + `/exec/tree/${firstJobId}`,
                method: 'GET'
            };
            const tree = await _request(opt);
            expect(tree.body[0]).to.have.property('children');
            expect(tree.body[0]).to.have.property('jobId');
            expect(tree.body[0]).to.have.property('name');
        });
        it('should run triggered cron pipelines and get the results', async () => {
            const requests = 10;
            const limit = 5;
            const pipeline = 'cron-test';
            const results = [];

            const options = {
                uri: realUrl + '/store/pipelines',
                method: 'POST',
                body: {
                    name: pipeline,
                    nodes: [
                        {
                            "nodeName": "green",
                            "algorithmName": "green-alg",
                            "input": [
                                "@flowInput"
                            ]
                        }
                    ],
                    flowInput: {
                        "files": {
                            "link": "links-1"
                        }
                    }
                }
            };
            await _request(options);

            // run the rest of the triggered pipelines
            for (let i = 0; i < requests; i++) {
                const options = {
                    method: 'POST',
                    uri: `${restUrl}/exec/stored`,
                    body: {
                        name: pipeline
                    }
                };
                const res = await _request(options);
                await workerStub.done({ jobId: res.body.jobId, data: i });
                results.push(res.body.jobId);
            }

            // get the cron results
            const qs = querystring.stringify({ sort: 'desc', limit });
            const opt = {
                uri: realUrl + `/exec/cron/results/${pipeline}?${qs}`,
                method: 'GET'
            };
            const response = await _request(opt);
            expect(response.response.statusCode).to.equal(200);
            expect(response.body).to.have.lengthOf(limit);
            expect(response.body[0]).to.have.property('jobId');
            expect(response.body[0]).to.have.property('data');
            expect(response.body[0]).to.have.property('storageModule');
            expect(response.body[0]).to.have.property('status');
            expect(response.body[0]).to.have.property('timeTook');
            expect(response.body[0]).to.have.property('timestamp');
        }).timeout(10000);
        it('pipeline tree call stack by trigger', async () => {
            let prefix = '57ec5c39-122b-4d7c-bc8f-580ba30df511';
            await Promise.all([
                stateManager.setExecution({ jobId: prefix + '.a', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.e', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.e.f', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.g', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.i', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h.j.k.l', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h.j.k.o', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.c.d.h.j.k.p', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.b.m', data: { startTime: Date.now() } }),
                stateManager.setExecution({ jobId: prefix + '.a.n', data: { startTime: Date.now() } })
            ]);
            let r = await stateManager.getExecutionsTree({ jobId: prefix + '.a' });
            expect(r).to.deep.equal(triggersTree);
        });
    });
});


