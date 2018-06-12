const bootstrap = require('../bootstrap');
const stateManager = require('../lib/states/stateManager');
global.stateManager = stateManager;
const messages = require('../lib/algorunnerCommunication/messages');
const { expect } = require('chai');
const sinon = require('sinon');
const workerCommunication = require('../lib/algorunnerCommunication/workerCommunication');
const config = {
    workerCommunication:
    {
        adapterName: 'loopback',
        config: {}
    }
};
describe('worker communication', () => {
    beforeEach(async () => {
        await bootstrap.init();
        await workerCommunication.init(config);
    });
    it('should create loopback adapter', async () => {
        await workerCommunication.init(config);
        expect(workerCommunication.adapter.constructor.name).to.equal('LoopbackWorkerCommunication');
    });
    it('should pass events', async () => {
        const spy = sinon.spy();
        const { adapter } = workerCommunication;
        workerCommunication.on(messages.incomming.started, spy);
        adapter.emit(messages.incomming.started, ['1', '2']);
        expect(spy.callCount).to.eq(1);
        expect(spy.getCall(0).args[0]).to.eql(['1', '2']);
    });

    it('should pass message.command events', async () => {
        const spy = sinon.spy();
        expect(stateManager.state).to.equal('bootstrap');
        stateManager.bootstrap();
        stateManager.prepare();
        expect(stateManager.state).to.equal('init');
        const { adapter } = workerCommunication;
        workerCommunication.on(messages.incomming.initialized, spy);
        adapter.send({ command: messages.outgoing.initialize, data: { xxx: 'yyy' } });
        expect(spy.callCount).to.eq(1);
        expect(spy.getCall(0).args[0]).to.eql({ xxx: 'yyy' });
    });
});
