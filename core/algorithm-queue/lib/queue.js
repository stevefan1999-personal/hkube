const log = require('@hkube/logger').GetLogFromContainer();
const components = require('./consts/component-name');
const _ = require('lodash');
const aigle = require('aigle');
const events = require('events');
const queueEvents = require('./consts/queue-events');

class Queue extends events {
    constructor({ scoreHeuristic = { run: null }, updateInterval = 1000, persistence = null, enrichmentRunner = { run: null } } = {}) {
        super();
        log.info(`new queue created with the following params updateInterval: ${updateInterval}`, { component: components.QUEUE });
        aigle.mixin(_);
        this.scoreHeuristic = scoreHeuristic.run ? scoreHeuristic.run.bind(scoreHeuristic) : scoreHeuristic.run;
        this.enrichmentRunner = enrichmentRunner.run ? enrichmentRunner.run.bind(enrichmentRunner) : enrichmentRunner.run;
        this.updateInterval = updateInterval;
        this.queue = [];
        this.isScoreDuringUpdate = false;
        this.tempInsertTasksQueue = [];
        this.tempRemoveJobIDsQueue = [];
        this.isIntervalRunning = true;
        this.persistence = persistence;
        this.persistencyLoad();
        this._queueInterval();
    }

    flush() {
        this.queue = [];
        this.tempInsertTasksQueue = [];
        this.tempRemoveJobIDsQueue = [];
    }

    async persistencyLoad() {
        log.info('try to recover data from persistent storage', { component: components.QUEUE });
        if (this.persistence) {
            try {
                const queueItems = await this.persistence.get();
                await this.add(queueItems);
                log.info('persistent added sucessfully', { component: components.QUEUE });
            }
            catch (e) {
                log.warning('could not add data from persistency ', { component: components.QUEUE });
            }
        }
        else {
            log.warning('persistency storage was not set ', { component: components.QUEUE });
        }
    }

    async persistenceStore() {
        log.debug('try to store data to  storage', { component: components.QUEUE });
        if (this.persistence) {
            try {
                await this.persistence.store(this.queue);
                log.debug('store data to storage succeed', { component: components.QUEUE });
            }
            catch (e) {
                log.error(`fail to store data. error is: ${e.message}`, { component: components.QUEUE }, e);
            }
        }
        else {
            log.warning('persistent storage not set', { component: components.QUEUE });
        }
    }

    // todo:add merge on async
    updateHeuristic(scoreHeuristic) {
        this.scoreHeuristic = scoreHeuristic.run.bind(scoreHeuristic);
        //   this.scoreHeuristic = heuristic.run.bind(heuristic);
    }

    /**
     * Add tasks (algorithms) to queue
     * @param {Array} tasks
     */
    async add(tasks) {
        if (this.scoreHeuristic) {
            const calculatedTasks = await aigle.map(tasks, task => this.scoreHeuristic(task));
            if (this.isScoreDuringUpdate) {
                log.debug('add -  score is currently updated so the remove is added to the temp arr ', { component: components.QUEUE });
                this.tempInsertTasksQueue = this.tempInsertTasksQueue.concat(calculatedTasks);
                return;
            }
            this._insert(calculatedTasks);
        }
        else {
            log.warning('score heuristic is not defined', { component: components.QUEUE });
        }
    }

    /**
     * Pop a task from queue
     */
    tryPop() {
        if (this.queue.length === 0) {
            return null;
        }
        const task = this.queue.shift();
        this.emit(queueEvents.POP, task);
        return task;
    }

    /**
     * Remove all tasks of given job IDs from queue
     * @param {Array} jobsId
     */
    removeJobId(jobsId) {
        if (this.isScoreDuringUpdate) {
            log.debug('remove -  score is currently updated so the remove is added to the temp arr ', { component: components.QUEUE });
            this.tempRemoveJobIDsQueue = this.tempRemoveJobIDsQueue.concat(jobsId);
            return;
        }
        this._removeJobID(jobsId);
    }

    async updateScore() {
        this.queue = await aigle.map(this.queue, job => this.scoreHeuristic(job));
        this.emit(queueEvents.UPDATE_SCORE, this.queue);
    }

    get get() {
        return this.queue;
    }

    set intervalRunningStatus(status) {
        this.isIntervalRunning = status;
    }

    _insert(taskArr) {
        if (taskArr.length === 0) {
            log.debug('there is no new inserted jobs', { component: components.QUEUE });
            return;
        }
        this.queue = _.orderBy([...this.queue, ...taskArr], j => j.calculated.score, 'desc');
        this.emit(queueEvents.INSERT, taskArr);
        log.info(`${taskArr.length} new jobs inserted to queue jobs`, { component: components.QUEUE });
    }

    _orderQueue() {
        this.queue = _.orderBy([...this.queue], j => j.calculated.score, 'desc');
    }

    _removeJobID(jobArr) {
        if (jobArr.length === 0) {
            log.debug('there is no deleted jobs', { component: components.QUEUE });
            return;
        }
        log.info(`${[...jobArr]} removed from queue  `, { component: components.QUEUE });
        let removedTasksArr = [];
        jobArr.forEach((jobId) => {
            // collect removed tasks to send in REMOVE event
            removedTasksArr = [].concat(removedTasksArr, _.remove(this.queue, task => task.jobId === jobId));
        });
        if (removedTasksArr.length === 0) {
            log.warning(`no task in queue is matching job IDs: ${jobArr.join('.')}`);
            return;
        }
        this.emit(queueEvents.REMOVE, removedTasksArr);
    }

    // should be merged after each interval cycle
    _mergeTemp() {
        this._insert(this.tempInsertTasksQueue);
        this._removeJobID(this.tempRemoveJobIDsQueue);
        this.tempInsertTasksQueue = [];
        this.tempRemoveJobIDsQueue = [];
    }

    // the interval logic should be as follows :
    // 1.if updateScore is running every new change entered to temp queue
    // 2. after each cycle merge with temp proceeded
    // 3. in case something is add when there is no running cycle each job inserted/ removed directly to the queue
    _queueInterval() {
        setTimeout(async () => {
            try {
                this.isScoreDuringUpdate = true;
                await this.enrichmentRunner(this.queue);
                await this.updateScore();
                log.debug('queue update score cycle starts', { component: components.QUEUE });
                this._mergeTemp();
                this._orderQueue();
                await this.persistenceStore();
                this.isScoreDuringUpdate = false;
            }
            catch (error) {
                log.throttle.error(`fail on queue interval ${error}`, { component: components.QUEUE });
            }
            finally {
                if (this.isIntervalRunning) {
                    this._queueInterval();
                }
            }
        }, this.updateInterval);
    }
}

module.exports = Queue;
