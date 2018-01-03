const heuristicsNames = require('../consts/heuristics-name');
const batch = {
    name: heuristicsNames.BATCH,
    algorithm: weight => job => weight * job.batch
    
};

module.exports = batch;