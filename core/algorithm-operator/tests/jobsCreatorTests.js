const configIt = require('@hkube/config');
const Logger = require('@hkube/logger');
const { main, logger } = configIt.load();
const log = new Logger(main.serviceName, logger);

const { expect } = require('chai');
const { createBuildJobSpec, applyName } = require('../lib/jobs/algorithm-builds');
const algorithmBuilderTemplate = require('../lib/templates/algorithm-builder');

describe('jobCreator', () => {
    describe('applyName', () => {
        it('should replace image name in spec', () => {
            const res = applyName(algorithmBuilderTemplate, 'myAlgo1');
            expect(res).to.nested.include({ 'metadata.name': 'build-myAlgo1' });
        });
    });
    it('should throw if no algorithm name', () => {
        expect(() => createBuildJobSpec({ version: 'v1.2' })).to.throw('Unable to create job spec. buildId is required');
    });
    it('should apply all required properties', () => {
        const buildId = 'my-alg-12345'
        const res = createBuildJobSpec({ buildId, versions: { versions: [{ project: 'algorithm-builder', tag: 'v1.2' }] }, options: main });
        expect(res).to.nested.include({ 'metadata.name': 'build-' + buildId });
        expect(res).to.nested.include({ 'spec.template.spec.containers[0].image': 'hkube/algorithm-builder:v1.2' });
        expect(res).to.nested.include({ 'metadata.labels.build-id': buildId });
        expect(res).to.nested.include({ 'metadata.labels.type': 'algorithm-builder' });
    });
});