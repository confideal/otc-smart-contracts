// From truffle-contract contract.js

import BigNumber from 'bignumber.js';

const ethJSABI = require("ethjs-abi");

module.exports = (C, logs) => logs.map(log => {
    const logABI = C.events[log.topics[0]];

    if (logABI == null) {
        return null;
    }

    // This function has been adapted from web3's SolidityEvent.decode() method,
    // and built to work with ethjs-abi.

    const copy = merge({}, log);

    const partialABI = (fullABI, indexed) => ({
        inputs: fullABI.inputs.filter(i => i.indexed === indexed),
        name: fullABI.name,
        type: fullABI.type,
        anonymous: fullABI.anonymous
    });

    const argTopics = logABI.anonymous ? copy.topics : copy.topics.slice(1);
    const indexedData = "0x" + argTopics.map(topics => topics.slice(2)).join("");
    const indexedParams = ethJSABI.decodeEvent(partialABI(logABI, true), indexedData);

    const notIndexedData = copy.data;
    const notIndexedParams = ethJSABI.decodeEvent(partialABI(logABI, false), notIndexedData);

    copy.event = logABI.name;

    copy.args = logABI.inputs.reduce((acc, current) => {
        let val = indexedParams[current.name];

        if (val === undefined) {
            val = notIndexedParams[current.name];
        }

        acc[current.name] = val;
        return acc;
    }, {});

    Object.keys(copy.args).forEach(key => {
        const val = copy.args[key];

        // We have BN. Convert it to BigNumber
        if (val.constructor.isBN) {
            copy.args[key] = new BigNumber("0x" + val.toString(16));
        }
    });

    delete copy.data;
    delete copy.topics;

    return copy;
}).filter(log => log != null);

const merge = function () {
    let merged = {};
    const args = Array.prototype.slice.call(arguments);

    for (let i = 0; i < args.length; i++) {
        const object = args[i];
        const keys = Object.keys(object);
        for (let j = 0; j < keys.length; j++) {
            const key = keys[j];
            merged[key] = object[key];
        }
    }

    return merged;
};
