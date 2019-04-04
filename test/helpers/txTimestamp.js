module.exports = async (tx) => {
    const block = await web3.eth.getBlock(tx.receipt.blockNumber);
    return block.timestamp;
};