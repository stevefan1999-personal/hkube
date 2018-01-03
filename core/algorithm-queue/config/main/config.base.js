const package = require(process.cwd() + '/package.json');
const  config = module.exports = {};
const heuristicsNames = require('../../lib/consts/heuristics-name')

config.serviceName = package.name;
const useCluster = process.env.REDIS_CLUSTER_SERVICE_HOST ? true : false;

config.redis = {
    host: useCluster ? process.env.REDIS_CLUSTER_SERVICE_HOST : process.env.REDIS_SERVICE_HOST || 'localhost',
    port: useCluster ? process.env.REDIS_CLUSTER_SERVICE_PORT : process.env.REDIS_SERVICE_PORT || 6379,
    cluster: useCluster
};

config.etcd = {
    protocol: 'http',
    host: process.env.ETCD_CLIENT_SERVICE_HOST || 'localhost',
    port: process.env.ETCD_CLIENT_SERVICE_PORT || 4001
};

config.queue={
   updateInterval : 1000 
}
config.heuristicsWeights = {
    [heuristicsNames.PRIORITY]:0.5,
    [heuristicsNames.ENTERANCE_TIME]:0.1,
    [heuristicsNames.BATCH]:-0.1
}
config.metrics = {
    collectDefault: true,
    server: {
        port: process.env.METRICS_PORT
    }
}

config.tracer = {
    tracerConfig: {
        serviceName: config.serviceName,
        reporter: {
            agentHost: process.env.JAEGER_AGENT_SERVICE_HOST || 'localhost',
            agentPort: process.env.JAEGER_AGENT_SERVICE_PORT_AGENT_BINARY || 6832
        }
    }
}