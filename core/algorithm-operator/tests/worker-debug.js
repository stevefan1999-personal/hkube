const configIt = require('@hkube/config');
const Logger = require('@hkube/logger');
const { main, logger } = configIt.load();
const log = new Logger(main.serviceName, logger);
const options = main;
const { expect } = require('chai');
const { createKindsSpec } = require('../lib/deployments/worker-debug.js');

describe('jobCreator', () => {
    describe('createKindsSpec', () => {
        it('should throw if no algorithm name', () => {
            expect(() => createKindsSpec({ algorithmName: '', options })).to.throw('Unable to create deployment spec. algorithmName is required');
        });
        it('should apply all required properties', () => {
            const versions = {
                "versions": [
                    {
                        "project": "worker",
                        "tag": "v1.2.3"
                    }
                ]
            };
            const { deploymentSpec, ingressSpec } = createKindsSpec({ algorithmName: 'myalgo1', options, versions });
            expect(deploymentSpec).to.nested.include({ 'metadata.labels.algorithm-name': 'myalgo1' });
            expect(deploymentSpec).to.nested.include({ 'spec.template.spec.containers[0].image': 'hkube/worker:v1.2.3' });
            expect(deploymentSpec.metadata.name).to.include('myalgo1');
            expect(ingressSpec.spec.rules[0].host).to.be.undefined;
            expect(ingressSpec).to.nested.include({ 'spec.rules[0].http.paths[0].path': '/hkube/debug/myalgo1' });
        });
        it('create job with volume', () => {
            const res = createKindsSpec({ algorithmName: 'myalgo1', options: { defaultStorage: 'fs' } }).deploymentSpec;
            expect(res.spec.template.spec).to.have.property('volumes');
            expect(res.spec.template.spec.containers[0]).to.have.property('volumeMounts');
            expect(res).to.nested.include({ 'metadata.labels.algorithm-name': 'myalgo1' });
            expect(res.metadata.name).to.include('myalgo1');
        });
        it('should use ingress host name', () => {
            const versions = {
                "versions": [
                    {
                        "project": "worker",
                        "tag": "v1.2.3"
                    }
                ]
            };
            const clusterOptions = {
                ingressHost: 'foo.bar.com',
                ingressPrefix: '/myprefix'
            }
            const { deploymentSpec, ingressSpec } = createKindsSpec({ algorithmName: 'myalgo1', options, versions, clusterOptions });
            expect(deploymentSpec).to.nested.include({ 'metadata.labels.algorithm-name': 'myalgo1' });
            expect(deploymentSpec).to.nested.include({ 'spec.template.spec.containers[0].image': 'hkube/worker:v1.2.3' });
            expect(ingressSpec).to.nested.include({ 'spec.rules[0].host': clusterOptions.ingressHost });
            expect(ingressSpec).to.nested.include({ 'spec.rules[0].http.paths[0].path': `${clusterOptions.ingressPrefix}/hkube/debug/myalgo1` });

        });
    });
});
