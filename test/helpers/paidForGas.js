const BN = web3.utils.BN;

module.exports = async (truffleTx) => {
    const gasPrice = new BN((await web3.eth.getTransaction(truffleTx.tx)).gasPrice);
    return gasPrice.mul(new BN(truffleTx.receipt.gasUsed));
};