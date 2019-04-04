const BN = web3.utils.BN;

module.exports = async (from, to, rest) => {
    const balance = new BN(await web3.eth.getBalance(from));
    if (balance.eq(new BN(0))) {
        return;
    }
    const gas = new BN(21000);
    const gasPrice = new BN(1);
    const cost = gas.mul(gasPrice);
    const sendAmount = balance.sub(cost).sub(new BN(rest));

    return web3.eth.sendTransaction({from: from, to: to, gas: gas, gasPrice: gasPrice, value: sendAmount});
};