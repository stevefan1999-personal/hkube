const producerSchema = {
    type: 'object',
    properties: {
        prefix: {
            type: 'string',
            default: 'algorithm-queue'
        }
    }
};

const startAlgorithmSchema = {
    type: 'object',
    properties: {
        execId: {
            type: 'string',
            minLength: 1
        },
        algorithmName: {
            type: 'string',
            minLength: 1
        },
        nodeName: {
            type: 'string',
            minLength: 1
        },
        input: {
            type: 'array'
        }
    },
    required: [
        'execId',
        'algorithmName'
    ]
};

const stopAlgorithmSchema = {
    type: 'object',
    properties: {
        execId: {
            type: 'string',
            minLength: 1
        },
        reason: {
            type: 'string'
        }
    },
    required: [
        'execId'
    ]
};

module.exports = {
    producerSchema,
    startAlgorithmSchema,
    stopAlgorithmSchema,
};
