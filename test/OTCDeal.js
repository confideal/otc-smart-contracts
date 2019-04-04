import * as ContractStage from '../helpers/ContractStage';
import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';

chai.use(chaiAsPromised);
const expect = chai.expect;
chai.should();
import BigNumber from 'bignumber.js';

const BN = web3.utils.BN;

const OTCDesk = artifacts.require('../OTCDesk.sol');
const OTCDeal = artifacts.require('../OTCDeal.sol');
const TestContractParty = artifacts.require('../TestContractParty.sol');

const decodeLogs = require('./helpers/decodeLogs');
const paidForGas = require('./helpers/paidForGas');
const txTimestamp = require('./helpers/txTimestamp');
const sendAll = require('./helpers/sendAll');

const sendAsync = (tx) => new Promise(
    (resolve, reject) => web3.currentProvider.send(tx, (err, success) => err ? reject(err) : resolve(success))
);

contract('OTCDeal', accounts => {
    const closeoutCredit = web3.utils.toWei('0.0017');

    const defaultAccount = accounts[0];
    const strangerAccount = accounts[4];
    const counterpartyAccount = accounts[5];
    const partnerAccount = accounts[6];
    const anotherPartnerAccount = accounts[7];
    const arbitratorAccount = accounts[8];
    const accountToBeEmpty = accounts[9];

    const dataHash = '0xc15a0175e131a752d83e216abc4e4ff3377278f83d50c0bec9bc3460e68696d6';
    const someHash = '0xc15a0175e131a752d83e216abc4e4ff3377278f83d50c0bec9bc3460e68696d3';
    const claimHash = '0x41b1a0649752af1b28b3dc29a1556eee781e4a4c3a1f7f53f90fa834de098c4d';
    const resolutionHash = '0x435cd288e3694b535549c3af56ad805c149f92961bf84a1c647f7d86fc2431b4';

    const defaults = {
        hash: dataHash,
        seller: defaultAccount,
        buyer: counterpartyAccount,
        sellerPartner: partnerAccount,
        buyerPartner: anotherPartnerAccount,
        price: '1.23456',
        paymentWindow: 3600,
        buyerIsTaker: false,
    };

    let creationTx;
    const createContract = async (params = {}) => {
        params = {
            ...defaults,
            ...params,
        };

        if (typeof params.value === 'undefined') {
            params.value = web3.utils.toWei(params.price);
        }

        const desk = await OTCDesk.deployed();
        creationTx = await desk.newDeal(
            params.hash,
            params.buyer,
            params.sellerPartner,
            params.buyerPartner,
            web3.utils.toWei(params.price),
            params.paymentWindow,
            params.buyerIsTaker,
            {
                value: params.value,
            }
        );

        return OTCDeal.at(creationTx.logs[0].args.deal);
    };

    describe('creation', () => {
        describe('buyer is taker', () => {
            it('should create a new contract', async () => {
                const contract = await createContract({
                    buyerIsTaker: true,
                    value: web3.utils.toWei(new BigNumber(defaults.price).mul(1.01).toString())
                });

                (await contract.dataHashes.call(0)).should.be.equal(dataHash);
                (await contract.seller.call()).should.be.equal(defaultAccount);
                (await contract.buyer.call()).should.be.equal(counterpartyAccount);
                (await contract.sellerPartner.call()).should.be.equal(partnerAccount);
                (await contract.buyerPartner.call()).should.be.equal(anotherPartnerAccount);
                (await contract.price.call()).toString().should.be.equal(web3.utils.toWei(defaults.price));
                (await contract.paymentDeadline.call())
                    .sub(new BN(await txTimestamp(creationTx))).toNumber()
                    .should.be.equal(defaults.paymentWindow);
                (await contract.deskFee.call()).mul(new BN(100)).toString()
                    .should.be.equal(web3.utils.toWei(defaults.price));
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Running);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(creationTx));
            });

            it('shouldn’t accept wrong payment', async () => {
                const contractTotal = new BN(web3.utils.toWei(new BigNumber(defaults.price).mul(1.01).toString()));
                await expect(createContract({buyerIsTaker: true, value: 0})).to.be.rejected;
                await expect(createContract({buyerIsTaker: true, value: contractTotal.sub(new BN(1))})).to.be.rejected;
                await expect(createContract({buyerIsTaker: true, value: contractTotal.add(new BN(1))})).to.be.rejected;
            });
        });

        describe('seller is taker', () => {
            it('should create a new contract', async () => {
                const contract = await createContract();
                (await contract.dataHashes.call(0)).should.be.equal(dataHash);
                (await contract.seller.call()).should.be.equal(defaultAccount);
                (await contract.buyer.call()).should.be.equal(counterpartyAccount);
                (await contract.sellerPartner.call()).should.be.equal(partnerAccount);
                (await contract.buyerPartner.call()).should.be.equal(anotherPartnerAccount);
                (await contract.price.call()).toString().should.be.equal(web3.utils.toWei(defaults.price));
                (await contract.paymentDeadline.call()).sub(new BN(await txTimestamp(creationTx))).toNumber()
                    .should.be.equal(defaults.paymentWindow);
                (await contract.deskFee.call()).mul(new BN(100)).toString()
                    .should.be.equal(web3.utils.toWei(defaults.price));
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Running);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(creationTx));
            });

            it('shouldn’t accept wrong payment', async () => {
                await expect(createContract({value: 0})).to.be.rejected;
                await expect(createContract({value: new BN(web3.utils.toWei(defaults.price)).sub(new BN(1))})).to.be.rejected;
                await expect(createContract({value: new BN(web3.utils.toWei(defaults.price)).add(new BN(1))})).to.be.rejected;
            });
        });
    });


    describe('prolongation by seller', () => {
        it('should prolong the payment deadline', async () => {
            const contract = await createContract();
            const tx = await contract.prolong(7200, someHash);
            (await contract.dataHashes.call(1)).should.be.equal(someHash);
            (await contract.paymentDeadline.call()).sub(new BN(7200)).toNumber().should.be.equal(await txTimestamp(tx));
            tx.logs.should.have.length(1);
            tx.logs[0].event.should.be.equal('PaymentDeadlineProlongation');
        });

        it('shouldn’t allow to decrease the payment deadline', async () => {
            const contract = await createContract();
            await expect(contract.prolong(1, someHash)).to.be.rejected;
        });

        it('shouldn’t allow non-seller to prolong the payment deadline', async () => {
            const contract = await createContract();
            await expect(contract.prolong(7200, someHash, {from: strangerAccount})).to.be.rejected;
        });
    });


    describe('termination', () => {
        describe('by buyer', () => {
            it('should terminate a running contract', async () => {
                const contract = await createContract();

                const balanceBeforeTermination = new BN(await web3.eth.getBalance(defaultAccount));
                const tx = await contract.terminate({from: counterpartyAccount});

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Terminated);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.sellerAssetSent.call()).should.be.true;
                (await web3.eth.getBalance(contract.address)).should.be.equal('0');
                web3.utils.fromWei(new BN(await web3.eth.getBalance(defaultAccount)).sub(balanceBeforeTermination))
                    .should.be.equal(defaults.price);
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Termination');
            });

            it('should terminate a contract when closeout is proposed', async () => {
                const contract = await createContract();

                const balanceBeforeTermination = new BN(await web3.eth.getBalance(defaultAccount));

                await contract.closeOut(0, {from: counterpartyAccount});
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.CloseoutProposed);

                const tx = await contract.terminate({from: counterpartyAccount});
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Terminated);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.sellerAssetSent.call()).should.be.true;
                (await web3.eth.getBalance(contract.address)).should.be.equal('0');
                web3.utils.fromWei(
                    new BN(await web3.eth.getBalance(defaultAccount))
                        .sub(balanceBeforeTermination))
                    .should.be.equal(defaults.price);
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Termination');
            });
        });

        describe('by seller', () => {
            it('should terminate a running contract when the payment deadline is expired', async () => {
                const contract = await createContract();
                await sendAsync({method: 'evm_snapshot'});
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [defaults.paymentWindow + 1]
                });

                const balanceBeforeTermination = new BN(await web3.eth.getBalance(defaultAccount));
                const tx = await contract.terminate();

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Terminated);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.sellerAssetSent.call()).should.be.true;
                (await web3.eth.getBalance(contract.address)).should.be.equal('0');
                web3.utils.fromWei(
                    new BN(await web3.eth.getBalance(defaultAccount))
                        .sub(balanceBeforeTermination)
                        .add(await paidForGas(tx)))
                    .should.be.equal(defaults.price);
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Termination');

                await sendAsync({method: 'evm_revert'});
            });

            it('shouldn’t allow to terminate a contract when closeout is proposed', async () => {
                const contract = await createContract();
                await sendAsync({method: 'evm_snapshot'});
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [defaults.paymentWindow + 1]
                });
                await contract.closeOut(0, {from: counterpartyAccount});
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.CloseoutProposed);
                await expect(contract.terminate()).to.be.rejected;
                await sendAsync({method: 'evm_revert'});
            });

            it('shouldn’t allow to terminate a contract within the payment window', async () => {
                const contract = await createContract();
                await expect(contract.terminate()).to.be.rejected;
            });

            it('should allow the seller to withdraw the termination refund', async () => {
                const desk = await OTCDesk.deployed();
                const testContractParty = await TestContractParty.new(desk.address);

                creationTx = await testContractParty.createContract(
                    defaults.hash,
                    defaults.buyer,
                    defaults.sellerPartner,
                    defaults.buyerPartner,
                    web3.utils.toWei(defaults.price),
                    defaults.paymentWindow,
                    defaults.buyerIsTaker,
                    {
                        value: web3.utils.toWei(defaults.price),
                    }
                );

                const logs = decodeLogs(OTCDesk, creationTx.receipt.rawLogs);
                logs.should.have.length(1);
                logs[0].event.should.be.equal('DealCreation');

                const contract = await OTCDeal.at(logs[0].args.deal);

                const tx = await contract.terminate({from: counterpartyAccount});
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Terminated);
                (await contract.sellerAssetSent.call()).should.be.false;

                const withdrawTx = await testContractParty.withdrawSellerAsset(contract.address);
                const withdrawLogs = decodeLogs(OTCDeal, withdrawTx.receipt.rawLogs);
                withdrawLogs.should.have.length(1);
                withdrawLogs[0].event.should.be.equal('SellerAssetWithdrawal');

                (await contract.sellerAssetSent.call()).should.be.true;
                (await web3.eth.getBalance(contract.address)).should.be.equal('0');
                web3.utils.fromWei(await web3.eth.getBalance(testContractParty.address))
                    .should.be.equal(defaults.price);
            });
        });


        it('shouldn’t allow a stranger to terminate the contract', async () => {
            const contract = await createContract();
            await sendAsync({method: 'evm_snapshot'});
            await sendAsync({method: 'evm_increaseTime', params: [defaults.paymentWindow + 1]});
            await expect(contract.terminate({from: strangerAccount})).to.be.rejected;
            await sendAsync({method: 'evm_revert'});
        });
    });


    describe('closeout', () => {
        describe('by buyer', () => {
            it('should make a proposition', async () => {
                const contract = await createContract();
                const tx = await contract.closeOut(8000000, {from: counterpartyAccount});
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.CloseoutProposed);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.isRefundByBuyerSet.call()).should.be.true;
                (await contract.refundByBuyer.call()).toString().should.be.equal('8000000');
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('CloseoutProposition');
            });

            it('should allow to change the proposition', async () => {
                const contract = await createContract();
                await contract.closeOut(8000000, {from: counterpartyAccount});
                const tx = await contract.closeOut(7000000, {from: counterpartyAccount});
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.CloseoutProposed);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.isRefundByBuyerSet.call()).should.be.true;
                (await contract.refundByBuyer.call()).toString().should.be.equal('7000000');
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('CloseoutProposition');
            });

            it('should allow to withdraw the closeout payment', async () => {
                const desk = await OTCDesk.deployed();
                const testContractParty = await TestContractParty.new(desk.address);

                await testContractParty.pay({value: closeoutCredit});
                const contract = await createContract({buyer: testContractParty.address});
                await testContractParty.closeOut(contract.address, web3.utils.toWei('1'));
                await contract.closeOut(web3.utils.toWei('1'));
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.ClosedOut);
                (await contract.buyerAssetSent.call()).should.be.false;

                const tx = await testContractParty.withdrawBuyerAsset(contract.address);
                const logs = decodeLogs(OTCDeal, tx.receipt.rawLogs);
                logs.should.have.length(1);
                logs[0].event.should.be.equal('BuyerAssetWithdrawal');

                (await contract.buyerAssetSent.call()).should.be.true;
                web3.utils.fromWei(
                    new BN(await web3.eth.getBalance(testContractParty.address))
                        .sub(new BN(closeoutCredit)))
                    .should.be.equal(
                    new BigNumber(defaults.price)
                        .mul(0.99)
                        .sub(1)
                        .toString());
            });
        });

        describe('by seller', () => {
            it('should make a proposition', async () => {
                const contract = await createContract();
                const tx = await contract.closeOut(8000000);
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.CloseoutProposed);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.isRefundBySellerSet.call()).should.be.true;
                (await contract.refundBySeller.call()).toString().should.be.equal('8000000');
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('CloseoutProposition');
            });

            it('should allow to change the proposition', async () => {
                const contract = await createContract();
                await contract.closeOut(8000000);
                const tx = await contract.closeOut(7000000);
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.CloseoutProposed);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.isRefundBySellerSet.call()).should.be.true;
                (await contract.refundBySeller.call()).toString().should.be.equal('7000000');
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('CloseoutProposition');
            });

            it('should close out the contract if no refund needed', async () => {
                const contract = await createContract();
                const deskBalanceBeforeCloseout = new BN(await web3.eth.getBalance(OTCDesk.address));
                const tx = await contract.closeOut(0);
                (await contract.status.call()).toNumber().should.be.equal(ContractStage.ClosedOut);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.sellerAsset.call()).toString().should.be.equal('0');
                web3.utils.fromWei(await contract.buyerAsset.call())
                    .should.be.equal(new BigNumber(defaults.price).mul(0.99).toString());
                (await contract.sellerAssetSent.call()).should.be.false;
                (await contract.buyerAssetSent.call()).should.be.true;
                web3.utils.fromWei(new BN(await web3.eth.getBalance(OTCDesk.address)).sub(deskBalanceBeforeCloseout))
                    .should.be.equal(new BigNumber(defaults.price).div(100).toString());
                (await web3.eth.getBalance(contract.address)).should.be.equal('0');
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Closeout');
            });

            it('should close out the contract if parties agree on refund', async () => {
                const contract = await createContract();
                const expectedSellerAsset = web3.utils.toWei('1');
                const expectedBuyerAsset = new BigNumber(web3.utils.toWei(defaults.price)).mul(0.99)
                    .sub(expectedSellerAsset).toString();
                await contract.closeOut(web3.utils.toWei('1'), {from: counterpartyAccount});
                const deskBalanceBeforeCloseout = new BN(await web3.eth.getBalance(OTCDesk.address));
                const sellerBalanceBeforeCloseout = new BN(await web3.eth.getBalance(defaultAccount));
                const buyerBalanceBeforeCloseout = new BN(await web3.eth.getBalance(counterpartyAccount));
                const tx = await contract.closeOut(web3.utils.toWei('1'));

                const deskLogs = decodeLogs(OTCDesk, tx.receipt.rawLogs);
                deskLogs.should.have.length(1);
                deskLogs[0].event.should.be.equal('FeePayment');
                deskLogs[0].args.deal.should.be.equal(contract.address.toLowerCase());
                deskLogs[0].args.amount.toString()
                    .should.be.equal(web3.utils.toWei(new BigNumber(defaults.price).div(100).toString()));

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.ClosedOut);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                (await contract.sellerAsset.call()).toString().should.be.equal(expectedSellerAsset);
                (await contract.buyerAsset.call()).toString().should.be.equal(expectedBuyerAsset);
                (await contract.sellerAssetSent.call()).should.be.true;
                (await contract.buyerAssetSent.call()).should.be.true;
                web3.utils.fromWei(new BN(await web3.eth.getBalance(OTCDesk.address)).sub(deskBalanceBeforeCloseout))
                    .should.be.equal(new BigNumber(defaults.price).div(100).toString());
                new BN(await web3.eth.getBalance(defaultAccount)).sub(sellerBalanceBeforeCloseout).toString()
                    .should.be.equal(new BigNumber(expectedSellerAsset).sub(await paidForGas(tx)).toString());
                new BN(await web3.eth.getBalance(counterpartyAccount)).sub(buyerBalanceBeforeCloseout).toString()
                    .should.be.equal(expectedBuyerAsset);
                (await web3.eth.getBalance(contract.address)).should.be.equal('0');
                tx.logs.should.have.length(2);
                tx.logs[0].event.should.be.equal('CloseoutProposition');
                tx.logs[1].event.should.be.equal('Closeout');
            });

            it('shouldn’t close out the contract if parties don’t agree on refund', async () => {
                const contract = await createContract();

                const tx1 = await contract.closeOut(8000000, {from: counterpartyAccount});

                const tx2 = await contract.closeOut(7000000);

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.CloseoutProposed);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx1));
                (await contract.sellerAsset.call()).toString().should.be.equal('0');
                (await contract.buyerAsset.call()).toString().should.be.equal('0');
                (await contract.sellerAssetSent.call()).should.be.false;
                (await contract.buyerAssetSent.call()).should.be.false;
                tx2.logs.should.have.length(1);
                tx2.logs[0].event.should.be.equal('CloseoutProposition');
            });

            it('should allow to withdraw the closeout refund', async () => {
                const testContractParty = await TestContractParty.new(OTCDesk.address);
                creationTx = await testContractParty.createContract(
                    defaults.hash,
                    defaults.buyer,
                    defaults.sellerPartner,
                    defaults.buyerPartner,
                    web3.utils.toWei(defaults.price),
                    defaults.paymentWindow,
                    true,
                    {
                        value: web3.utils.toWei(new BigNumber(defaults.price).mul(1.01).toString()),
                    }
                );

                const creationLogs = decodeLogs(OTCDesk, creationTx.receipt.rawLogs);
                creationLogs.should.have.length(1);
                creationLogs[0].event.should.be.equal('DealCreation');

                const contract = await OTCDeal.at(creationLogs[0].args.deal);

                await testContractParty.closeOut(contract.address, web3.utils.toWei('1'));
                await contract.closeOut(web3.utils.toWei('1'), {from: counterpartyAccount});

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.ClosedOut);
                (await contract.sellerAssetSent.call()).should.be.false;

                const withdrawTx = await testContractParty.withdrawSellerAsset(contract.address);

                const withdrawLogs = decodeLogs(OTCDeal, withdrawTx.receipt.rawLogs);
                withdrawLogs.should.have.length(1);
                withdrawLogs[0].event.should.be.equal('SellerAssetWithdrawal');

                (await contract.sellerAssetSent.call()).should.be.true;

                web3.utils.fromWei(await web3.eth.getBalance(testContractParty.address))
                    .should.be.equal('1');
            });
        });

        it('shouldn’t allow to propose a refund greater than available', async () => {
            const contract = await createContract();

            await expect(contract.closeOut(new BigNumber(web3.utils.toWei(defaults.price)).mul('0.99').add(1).toString())).to.be.rejected;
            await expect(contract.closeOut(new BigNumber(web3.utils.toWei(defaults.price)).mul('0.99').toString())).to.be.fulfilled;
        });

        it('shouldn’t allow a third party to close out a contract', async () => {
            const contract = await createContract();

            await expect(contract.closeOut(0, {from: strangerAccount})).to.be.rejected;
        });
    })
    ;


    describe('escalation', () => {
        describe('by buyer', () => {
            it('should escalate on a running contract', async () => {
                const contract = await createContract();
                await sendAsync({method: 'evm_snapshot'});
                const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
                const deadline = (await contract.paymentDeadline.call()).toNumber();
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [deadline - blockTimestamp + 7200]
                });

                const tx = await contract.escalate(claimHash, {from: counterpartyAccount});

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Arbitration');

                await sendAsync({method: 'evm_revert'});
            });

            it('should escalate when closeout is proposed', async () => {
                const contract = await createContract();
                await contract.closeOut(0, {from: counterpartyAccount});
                await sendAsync({method: 'evm_snapshot'});
                const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
                const deadline = (await contract.paymentDeadline.call()).toNumber();
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [deadline - blockTimestamp + 7200]
                });

                const tx = await contract.escalate(claimHash, {from: counterpartyAccount});

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Arbitration');

                await sendAsync({method: 'evm_revert'});
            });

            it('should try to assign arbitrator from the pool on escalate', async () => {
                const contract = await createContract();
                await sendAsync({method: 'evm_snapshot'});
                const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
                const deadline = (await contract.paymentDeadline.call()).toNumber();
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [deadline - blockTimestamp + 7200]
                });

                const desk = await OTCDesk.deployed();
                await desk.addArbitratorToPool(arbitratorAccount);

                const tx = await contract.escalate(claimHash, {from: counterpartyAccount});

                await desk.removeArbitratorFromPool(0);

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Arbitration');

                const deskLogs = decodeLogs(OTCDesk, tx.receipt.rawLogs);
                deskLogs.should.have.length(1);
                deskLogs[0].event.should.be.equal('ArbitratorAssignment');
                deskLogs[0].args.deal.should.be.equal(contract.address.toLowerCase());
                deskLogs[0].args.arbitrator.should.be.equal(arbitratorAccount.toLowerCase());

                await sendAsync({method: 'evm_revert'});
            });
        });

        describe('by seller', () => {
            it('should escalate on a running contract', async () => {
                const contract = await createContract();
                await sendAsync({method: 'evm_snapshot'});
                const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
                const deadline = (await contract.paymentDeadline.call()).toNumber();
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [deadline - blockTimestamp + 7200]
                });

                const tx = await contract.escalate(claimHash);

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Arbitration');

                await sendAsync({method: 'evm_revert'});
            });

            it('should escalate when closeout is proposed', async () => {
                const contract = await createContract();
                await contract.closeOut(0, {from: counterpartyAccount});
                await sendAsync({method: 'evm_snapshot'});
                const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
                const deadline = (await contract.paymentDeadline.call()).toNumber();
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [deadline - blockTimestamp + 7200]
                });

                const tx = await contract.escalate(claimHash);

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Arbitration');

                await sendAsync({method: 'evm_revert'});
            });

            it('should try to assign arbitrator from the pool on escalate', async () => {
                const contract = await createContract();
                await sendAsync({method: 'evm_snapshot'});
                const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
                const deadline = (await contract.paymentDeadline.call()).toNumber();
                await sendAsync({
                    method: 'evm_increaseTime',
                    params: [deadline - blockTimestamp + 7200]
                });

                const desk = await OTCDesk.deployed();
                await desk.addArbitratorToPool(arbitratorAccount);

                const tx = await contract.escalate(claimHash);

                await desk.removeArbitratorFromPool(0);

                (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);
                (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
                tx.logs.should.have.length(1);
                tx.logs[0].event.should.be.equal('Arbitration');

                const deskLogs = decodeLogs(OTCDesk, tx.receipt.rawLogs);
                deskLogs.should.have.length(1);
                deskLogs[0].event.should.be.equal('ArbitratorAssignment');
                deskLogs[0].args.deal.should.be.equal(contract.address.toLowerCase());
                deskLogs[0].args.arbitrator.should.be.equal(arbitratorAccount.toLowerCase());

                await sendAsync({method: 'evm_revert'});
            });
        });

        it('shouldn’t allow a third party to escalate', async () => {
            const contract = await createContract();
            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200]
            });

            await expect(contract.escalate(claimHash, {from: strangerAccount})).to.be.rejected;

            await sendAsync({method: 'evm_revert'});
        });

        it('shouldn’t allow to escalate earlier than 2 hours after the payment deadline', async () => {
            const contract = await createContract();
            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200 - 3]
            });

            await expect(contract.escalate(claimHash)).to.be.rejected;

            await sendAsync({method: 'evm_revert'});
        });
    });


    describe('dispute resolution', () => {
        it('should resolve a dispute', async () => {
            const contract = await createContract({
                buyerIsTaker: true,
                value: web3.utils.toWei(new BigNumber(defaults.price).mul('1.01').toString()),
            });
            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200]
            });

            await contract.escalate(claimHash, {from: counterpartyAccount});

            (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);

            const desk = await OTCDesk.deployed();
            await desk.assignArbitrator(contract.address, arbitratorAccount);
            const tx = await desk.resolveDispute(contract.address, resolutionHash, web3.utils.toWei('1'), {from: arbitratorAccount});

            const deskLogs = decodeLogs(OTCDesk, tx.receipt.rawLogs);
            deskLogs.should.have.length(1);
            deskLogs[0].event.should.be.equal('FeePayment');
            deskLogs[0].args.deal.should.be.equal(contract.address.toLowerCase());
            web3.utils.fromWei(deskLogs[0].args.amount.toString())
                .should.be.equal(new BigNumber(defaults.price).div(100).toString());

            const dealLogs = decodeLogs(OTCDeal, tx.receipt.rawLogs);
            dealLogs.should.have.length(1);
            dealLogs[0].event.should.be.equal('DisputeResolution');

            (await contract.status.call()).toNumber().should.be.equal(ContractStage.Resolved);
            (await contract.statusTime.call()).toNumber().should.be.equal(await txTimestamp(tx));
            (await contract.dataHashes.call(1)).should.be.equal(resolutionHash);
            web3.utils.fromWei(await contract.sellerAsset.call()).toString().should.be.equal('1');
            web3.utils.fromWei(await contract.buyerAsset.call()).toString()
                .should.be.equal(new BigNumber(defaults.price).sub(1).toString());
            (await contract.sellerAssetSent.call()).should.be.true;
            (await contract.buyerAssetSent.call()).should.be.true;

            await sendAsync({method: 'evm_revert'});
        });

        it('should allow to withdraw seller asset', async () => {
            const testContractParty = await TestContractParty.new(OTCDesk.address);

            creationTx = await testContractParty.createContract(
                defaults.hash,
                defaults.buyer,
                defaults.sellerPartner,
                defaults.buyerPartner,
                web3.utils.toWei(defaults.price),
                defaults.paymentWindow,
                defaults.buyerIsTaker,
                {
                    value: web3.utils.toWei(defaults.price),
                });

            const logs = decodeLogs(OTCDesk, creationTx.receipt.rawLogs);
            logs.should.have.length(1);
            logs[0].event.should.be.equal('DealCreation');

            const contract = await OTCDeal.at(logs[0].args.deal);

            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200]
            });

            await contract.escalate(claimHash, {from: counterpartyAccount});

            const desk = await OTCDesk.deployed();
            await desk.assignArbitrator(contract.address, arbitratorAccount);
            await desk.resolveDispute(contract.address, resolutionHash, web3.utils.toWei('1'), {from: arbitratorAccount});

            (await contract.status.call()).toNumber().should.be.equal(ContractStage.Resolved);
            web3.utils.fromWei(await contract.sellerAsset.call()).toString().should.be.equal('1');
            (await contract.sellerAssetSent.call()).should.be.false;

            const tx = await testContractParty.withdrawSellerAsset(contract.address);

            (await contract.sellerAssetSent.call()).should.be.true;
            web3.utils.fromWei(await web3.eth.getBalance(testContractParty.address))
                .should.be.equal('1');

            await sendAsync({method: 'evm_revert'});
        });

        it('should allow to withdraw buyer asset', async () => {
            const testContractParty = await TestContractParty.new(OTCDesk.address);
            await testContractParty.pay({value: closeoutCredit});

            const contract = await createContract({buyer: testContractParty.address});

            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200]
            });

            await contract.escalate(claimHash);

            const desk = await OTCDesk.deployed();
            await desk.assignArbitrator(contract.address, arbitratorAccount);
            await desk.resolveDispute(contract.address, resolutionHash, 0, {from: arbitratorAccount});

            (await contract.status.call()).toNumber().should.be.equal(ContractStage.Resolved);
            web3.utils.fromWei(await contract.buyerAsset.call()).toString()
                .should.be.equal(new BigNumber(defaults.price).mul(0.99).toString());
            (await contract.buyerAssetSent.call()).should.be.false;

            const tx = await testContractParty.withdrawBuyerAsset(contract.address);

            (await contract.buyerAssetSent.call()).should.be.true;
            web3.utils.fromWei(await web3.eth.getBalance(testContractParty.address))
                .should.be.equal(new BigNumber(defaults.price).mul(0.99).plus(web3.utils.fromWei(closeoutCredit)).toString());

            await sendAsync({method: 'evm_revert'});
        });

        it('shouldn’t allow assets greater than available', async () => {
            const testContractParty = await TestContractParty.new(OTCDesk.address);
            await testContractParty.pay({value: closeoutCredit});

            const contract = await createContract({buyer: testContractParty.address});

            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200]
            });

            await contract.escalate(claimHash);

            const desk = await OTCDesk.deployed();
            await desk.assignArbitrator(contract.address, arbitratorAccount);

            await expect(desk.resolveDispute(contract.address, resolutionHash,
                new BN(web3.utils.toWei(new BigNumber(defaults.price).mul('0.99').toString())).add(new BN(1)),
                {from: arbitratorAccount}))
                .to.be.rejected;
            await expect(desk.resolveDispute(contract.address, resolutionHash,
                web3.utils.toWei(new BigNumber(defaults.price).mul('0.99').toString()),
                {from: arbitratorAccount}))
                .to.be.fulfilled;

            await sendAsync({method: 'evm_revert'});
        });

        it('shouldn’t allow a stranger to resolve a dispute', async () => {
            const contract = await createContract();

            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200]
            });

            await contract.escalate(claimHash, {from: counterpartyAccount});

            (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);

            await expect(contract.resolveDispute(resolutionHash, 0, {from: strangerAccount})).to.be.rejected;

            await sendAsync({method: 'evm_revert'});
        });
    });


    describe('closeout credit', () => {
        it('should return the closeout credit on the contract closeout', async () => {
            const reducedCredit = new BigNumber(closeoutCredit).sub(888).toString();
            await web3.eth.sendTransaction({from: defaultAccount, to: accountToBeEmpty, value: closeoutCredit});
            await sendAll(accountToBeEmpty, defaultAccount, 888);

            const desk = await OTCDesk.deployed();
            await desk.contribute({value: reducedCredit});

            const contract = await createContract({buyer: accountToBeEmpty});

            const tx = await contract.closeOut(0);
            const logs = decodeLogs(OTCDesk, tx.receipt.rawLogs);
            logs.should.have.length(2);
            logs[0].event.should.be.equal('FeePayment');
            logs[1].event.should.be.equal('CloseoutCreditCollection');
            logs[1].args.deal.should.be.equal(contract.address.toLowerCase());
            logs[1].args.amount.toString().should.be.equal(reducedCredit);

            web3.utils.fromWei(await web3.eth.getBalance(accountToBeEmpty))
                .should.be.equal(new BigNumber(defaults.price).mul('0.99').add(web3.utils.fromWei('888')).toString());
        });

        it('should return the closeout credit on the dispute resolution', async () => {
            await web3.eth.sendTransaction({from: defaultAccount, to: accountToBeEmpty, value: closeoutCredit});
            await sendAll(accountToBeEmpty, defaultAccount, 0);

            const desk = await OTCDesk.deployed();
            await desk.contribute({value: closeoutCredit});

            const contract = await createContract({buyer: accountToBeEmpty});

            await sendAsync({method: 'evm_snapshot'});
            const blockTimestamp = (await web3.eth.getBlock("latest")).timestamp;
            const deadline = (await contract.paymentDeadline.call()).toNumber();
            await sendAsync({
                method: 'evm_increaseTime',
                params: [deadline - blockTimestamp + 7200]
            });

            const escalateTx = await contract.escalate(claimHash, {
                from: accountToBeEmpty,
                gasPrice: 10000000000,
                gas: 170000
            });
            (await contract.status.call()).toNumber().should.be.equal(ContractStage.Arbitration);

            await desk.assignArbitrator(contract.address, arbitratorAccount);
            const tx = await desk.resolveDispute(contract.address, resolutionHash, web3.utils.toWei('1'), {from: arbitratorAccount});

            const logs = decodeLogs(OTCDesk, tx.receipt.rawLogs);
            logs.should.have.length(2);
            logs[0].event.should.be.equal('FeePayment');
            logs[1].event.should.be.equal('CloseoutCreditCollection');
            logs[1].args.deal.should.be.equal(contract.address.toLowerCase());
            logs[1].args.amount.toString().should.be.equal(closeoutCredit.toString());
            web3.utils.fromWei(await web3.eth.getBalance(accountToBeEmpty))
                .should.be.equal(new BigNumber(defaults.price).mul('0.99').sub(1).sub(web3.utils.fromWei(await paidForGas(escalateTx))).toString());

            await sendAsync({method: 'evm_revert'});
        });

        it('shouldn’t pay out the closeout payment if it is less than the closeout credit', async () => {
            const reducedCredit = new BigNumber(closeoutCredit).sub(888).toString();

            await web3.eth.sendTransaction({from: defaultAccount, to: accountToBeEmpty, value: closeoutCredit});
            await sendAll(accountToBeEmpty, defaultAccount, 888);

            const desk = await OTCDesk.deployed();
            await desk.contribute({value: reducedCredit});

            const contract = await createContract({buyer: accountToBeEmpty});

            await contract.closeOut(web3.utils.toWei('1.222'));
            const tx = await contract.closeOut(web3.utils.toWei('1.222'), {
                from: accountToBeEmpty,
                gasPrice: 10000000000,
                gas: 170000
            });

            const logs = decodeLogs(OTCDesk, tx.receipt.rawLogs);
            logs.should.have.length(2);
            logs[0].event.should.be.equal('FeePayment');
            logs[1].event.should.be.equal('CloseoutCreditCollection');
            logs[1].args.deal.should.be.equal(contract.address.toLowerCase());
            web3.utils.fromWei(logs[1].args.amount.toString())
                .should.be.equal(new BigNumber(defaults.price).mul('0.99').sub('1.222').toString());

            (await contract.buyerAsset.call()).toString().should.be.equal('0');
        });
    });
});