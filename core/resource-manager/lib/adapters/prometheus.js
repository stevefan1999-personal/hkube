
const Adapter = require('./Adapter');

class PrometheusAdapter extends Adapter {

    constructor(settings, options) {
        super(settings);
    }

    getData() {
        return prometheus;
    }
}

module.exports = PrometheusAdapter;