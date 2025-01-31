const clonedeep = require('lodash.clonedeep');
const configIt = require('@hkube/config');
const Logger = require('@hkube/logger');
const { main, logger } = configIt.load();
const log = new Logger(main.serviceName, logger);
const options = main;
const { expect } = require('chai');
const { applyAlgorithmImage, applyAlgorithmName, applyWorkerImage, createJobSpec, applyHotWorker } = require('../lib/jobs/jobCreator'); // eslint-disable-line object-curly-newline
const { jobTemplate } = require('./stub/jobTemplates');
const { settings: globalSettings } = require('../lib/helpers/settings');

describe('jobCreator', () => {
    describe('applyAlgorithmName', () => {
        it('should replace image name in spec', () => {
            const res = applyAlgorithmName(jobTemplate, 'myAlgo1');
            expect(res).to.nested.include({ 'metadata.labels.algorithm-name': 'myAlgo1' });
            expect(res).to.nested.include({ 'spec.template.metadata.labels.algorithm-name': 'myAlgo1' });
        });
        it('should throw if no worker container', () => {
            const missingWorkerSpec = clonedeep(jobTemplate);
            missingWorkerSpec.spec.template.spec.containers.splice(0, 1);
            expect(() => applyAlgorithmName(missingWorkerSpec, 'myAlgo1')).to.throw('unable to find container worker');
        });
    });
    describe('applyImageName', () => {
        it('should replace algorithm image name in spec', () => {
            const res = applyAlgorithmImage(jobTemplate, 'registry:5000/myAlgo1Image:v2');
            expect(res).to.nested.include({ 'spec.template.spec.containers[1].image': 'registry:5000/myAlgo1Image:v2' });
        });
        it('should throw if no algorithm container', () => {
            const missingAlgorunnerSpec = clonedeep(jobTemplate);
            missingAlgorunnerSpec.spec.template.spec.containers.splice(1, 1);
            expect(() => applyAlgorithmImage(missingAlgorunnerSpec, 'registry:5000/myAlgo1Image:v2')).to.throw('unable to find container algorunner');
        });
    });
    describe('applyWorkerImageName', () => {
        it('should replace worker image name in spec', () => {
            const res = applyWorkerImage(jobTemplate, 'workerImage:v2');
            expect(res).to.nested.include({ 'spec.template.spec.containers[0].image': 'workerImage:v2' });
        });
        it('should throw if no worker container2', () => {
            const missingWorkerSpec = clonedeep(jobTemplate);
            missingWorkerSpec.spec.template.spec.containers.splice(0, 1);
            expect(() => applyWorkerImage(missingWorkerSpec, 'workerImage:v2')).to.throw('unable to find container worker');
        });
    });
    describe('applyHotWorker', () => {
        it('should add env to spec', () => {
            const res = applyHotWorker(jobTemplate, false);
            expect(res).to.eql(jobTemplate);
        });
        it('should replace env in spec', () => {
            const res = applyHotWorker(jobTemplate, true);
            expect(res.spec.template.spec.containers[0].env).to.have.lengthOf(6);
            expect(res.spec.template.spec.containers[0].env).to.deep.include({ name: 'HOT_WORKER', value: 'true' });
        });
    });
    describe('jobSpec', () => {
        beforeEach(() => {
            globalSettings.applyResources = false;
        });
        it('should throw if no image name', () => {
            expect(() => createJobSpec({ algorithmName: 'myalgo1', options })).to.throw('Unable to create job spec. algorithmImage is required');
        });
        it('should throw if no algorithm name', () => {
            expect(() => createJobSpec({ algorithmImage: 'myImage1', options })).to.throw('Unable to create job spec. algorithmName is required');
        });
        it('should apply all required properties', () => {
            const res = createJobSpec({ algorithmImage: 'myImage1', algorithmName: 'myalgo1', options });
            expect(res).to.nested.include({ 'spec.template.spec.containers[1].image': 'myImage1' });
            expect(res).to.nested.include({ 'metadata.labels.algorithm-name': 'myalgo1' });
            expect(res).to.nested.include({ 'spec.template.spec.containers[0].image': 'hkube/worker:latest' });

            expect(res.metadata.name).to.include('myalgo1-');
        });
        it('should apply with worker', () => {
            const res = createJobSpec({ algorithmImage: 'myImage1', algorithmName: 'myalgo1', workerImage: 'workerImage2', options });
            expect(res).to.nested.include({ 'spec.template.spec.containers[0].image': 'workerImage2' });
            expect(res).to.nested.include({ 'spec.template.spec.containers[1].image': 'myImage1' });
            expect(res).to.nested.include({ 'metadata.labels.algorithm-name': 'myalgo1' });
            expect(res.metadata.name).to.include('myalgo1-');
        });
        it('should apply with worker and resources', () => {
            globalSettings.applyResources = true;

            const res = createJobSpec({
                algorithmImage: 'myImage1',
                algorithmName: 'myalgo1',
                workerImage: 'workerImage2',
                options,
                resourceRequests: { requests: { cpu: '200m' }, limits: { cpu: '500m', memory: '200M' } },
                workerResourceRequests: { requests: { cpu: '100m' }, limits: { cpu: '200m', memory: '100Mi' } }
            });
            expect(res).to.nested.include({ 'spec.template.spec.containers[0].image': 'workerImage2' });
            expect(res).to.nested.include({ 'spec.template.spec.containers[1].image': 'myImage1' });
            expect(res).to.nested.include({ 'metadata.labels.algorithm-name': 'myalgo1' });
            expect(res.metadata.name).to.include('myalgo1-');
            expect(res.spec.template.spec.containers[1].resources).to.deep.include({ requests: { cpu: '200m' } });
            expect(res.spec.template.spec.containers[1].resources).to.deep.include({ limits: { cpu: '500m', memory: '200M' } });
            expect(res.spec.template.spec.containers[0].resources).to.deep.include({ limits: { cpu: '200m', memory: '100Mi' } });
        });
    });
});
