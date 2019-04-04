const OTCDesk = artifacts.require('./OTCDesk.sol');

module.exports = function (deployer, network) {
    return deployer.deploy(OTCDesk).then(() => {
        if (network === 'main') {
            const contractsFileName = 'main-contracts.json';
            const contracts = require('../' + contractsFileName);
            contracts.unshift({
                address: OTCDesk.address,
                timestamp: Math.floor(new Date() / 1000),
            });

            const fs = module.require('fs');
            fs.writeFileSync(contractsFileName, JSON.stringify(contracts, null, 4), 'utf8');
        }
    });
};
