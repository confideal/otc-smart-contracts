import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';

chai.use(chaiAsPromised);
const expect = chai.expect;
chai.should();
import BigNumber from 'bignumber.js';

const BN = web3.utils.BN;

const OTCDesk = artifacts.require('../OTCDesk.sol');
const DealMock = artifacts.require('../OTCMock.sol');

const paidForGas = require('./helpers/paidForGas');
const sendAll = require('./helpers/sendAll');

contract('OTCDesk', accounts => {
    const closeoutCredit = web3.utils.toWei('0.0017');

    const deployAccount = accounts[0];
    const arbitrationManagerAccount = accounts[5];
    const partnerAccount = accounts[6];
    const anotherPartnerAccount = accounts[7];
    const accountToBeEmpty = accounts[9];

    const contractAddress = '0x22FC9A94D295Ad2a237eeE2621Cc424981dC1b77';
    const resolutionHash = '0xc15a0175e131a752d83e216abc4e4ff3377278f8';

    const defaults = {
        hash: '0xc15a0175e131a752d83e216abc4e4ff3377278f83d50c0bec9bc3460e68696d6',
        price: 3,
        paymentWindow: 3600,
        buyerIsTaker: false,
    };

    it('should allow the contract owner to transfer ownership', async () => {
        const desk = await OTCDesk.deployed();
        await expect(desk.transferOwnership(accounts[1])
            .then(() => desk.transferOwnership(deployAccount, {from: accounts[1]}))
        ).to.be.fulfilled;
    });

    it('shouldn’t allow the contract owner to transfer ownership to empty address', async () => {
        const desk = await OTCDesk.deployed();
        await expect(desk.transferOwnership('0x0')).to.be.rejected;
    });

    it('shouldn’t allow non-owner to change an owner', async () => {
        const desk = await OTCDesk.deployed();
        await expect(desk.transferOwnership(accounts[1], {from: accounts[1]})).to.be.rejected;
    });

    it('should set the contract owner as a beneficiary by default', async () => {
        const desk = await OTCDesk.deployed();
        (await desk.beneficiary.call()).should.be.equal(deployAccount);
    });

    it('should allow the contract owner to change a beneficiary', async () => {
        const desk = await OTCDesk.deployed();
        await desk.setBeneficiary(accounts[1]);
        (await desk.beneficiary.call()).should.be.equal(accounts[1]);
        await desk.setBeneficiary(deployAccount);
    });

    it('shouldn’t allow a third party to change a beneficiary', async () => {
        const desk = await OTCDesk.deployed();
        await expect(desk.setBeneficiary(accounts[1], {from: accounts[1]})).to.be.rejected;
    });

    it('should set the contract owner as an arbitration manager by default', async () => {
        const desk = await OTCDesk.deployed();
        (await desk.arbitrationManager.call()).should.be.equal(deployAccount);
    });

    it('should allow the contract owner to change an arbitration manager', async () => {
        const desk = await OTCDesk.deployed();
        await desk.setArbitrationManager(accounts[1]);
        (await desk.arbitrationManager.call()).should.be.equal(accounts[1]);
        await desk.setArbitrationManager(deployAccount);
    });

    it('shouldn’t allow a third party to change an arbitration manager', async () => {
        const desk = await OTCDesk.deployed();
        await expect(desk.setArbitrationManager(accounts[1], {from: accounts[1]})).to.be.rejected;
    });

    it('should allow the contract owner to change the closeout credit amount', async () => {
        const desk = await OTCDesk.deployed();
        await desk.setCloseoutCredit(8);
        (await desk.closeoutCredit.call()).toString().should.be.equal('8');
        await desk.setCloseoutCredit(closeoutCredit);
    });

    it('shouldn’t allow third party to change the closeout credit amount', async () => {
        const desk = await OTCDesk.deployed();
        await expect(desk.setCloseoutCredit(8, {from: accounts[1]})).to.be.rejected;
    });

    it('should allow beneficiary to withdraw funds', async () => {
        const desk = await OTCDesk.deployed();

        if (await web3.eth.getBalance(desk.address) !== '0') {
            await desk.withdraw(0);
        }

        await desk.collectFee(web3.utils.toWei('0.01'), {from: accounts[5], value: web3.utils.toWei('1')});
        const balanceBefore = new BN(await web3.eth.getBalance(deployAccount));
        const withdrawTx = await desk.withdraw(0);

        (await web3.eth.getBalance(deployAccount)).should.be.equal(
            balanceBefore
                .add(new BN(web3.utils.toWei('1')))
                .sub(await paidForGas(withdrawTx))
                .toString());
    });

    it('should allow beneficiary to withdraw funds partly', async () => {
        const desk = await OTCDesk.deployed();
        await desk.collectFee(0, {from: accounts[5], value: web3.utils.toWei('1')});
        const balanceBefore = new BN(await web3.eth.getBalance(deployAccount));
        const withdrawTx = await desk.withdraw(web3.utils.toWei('0.01'));
        (await desk.confidealFund.call()).toString().should.be.equal(web3.utils.toWei('0.01'));
        (await web3.eth.getBalance(deployAccount)).should.be.equal(
            balanceBefore
                .add(new BN(web3.utils.toWei('0.99')))
                .sub(await paidForGas(withdrawTx))
                .toString());
    });

    it('shouldn’t allow non-beneficiary to withdraw funds', async () => {
        const desk = await OTCDesk.deployed();
        await desk.collectFee(0, {from: accounts[5], value: web3.utils.toWei('1')});
        await expect(desk.withdraw(0, {from: accounts[1]})).to.be.rejected;
    });

    it('shouldn’t accept incoming ETH transfers', async () => {
        const desk = await OTCDesk.deployed();
        await expect(desk.sendTransaction({from: accounts[0], to: desk.address, value: 123456789})).to.be.rejected;
    });

    describe('arbitration', () => {
        it('should allow the arbitration manager to add and remove arbitrators to/from the pool', async () => {
            const desk = await OTCDesk.deployed();
            await desk.setArbitrationManager(arbitrationManagerAccount, {from: deployAccount});

            (await desk.arbitratorsPoolSize()).toNumber().should.be.equal(0);

            await desk.addArbitratorToPool(accounts[1], {from: arbitrationManagerAccount});
            (await desk.arbitratorsPoolSize()).toNumber().should.be.equal(1);
            (await desk.arbitratorsPool(0)).should.be.equal(accounts[1]);

            await desk.addArbitratorToPool(accounts[2], {from: arbitrationManagerAccount});
            (await desk.arbitratorsPoolSize()).toNumber().should.be.equal(2);
            (await desk.arbitratorsPool(1)).should.be.equal(accounts[2]);

            await desk.removeArbitratorFromPool(0, {from: arbitrationManagerAccount});
            (await desk.arbitratorsPoolSize()).toNumber().should.be.equal(1);
            (await desk.arbitratorsPool(0)).should.be.equal(accounts[2]);

            await desk.removeArbitratorFromPool(0, {from: arbitrationManagerAccount});
            (await desk.arbitratorsPoolSize()).toNumber().should.be.equal(0);
        });

        it('shouldn’t allow a third party to add arbitrator to the pool', async () => {
            const desk = await OTCDesk.deployed();
            await expect(desk.addArbitratorToPool(accounts[1], {from: accounts[1]})).to.be.rejected;
        });

        it('shouldn’t allow a third party to remove arbitrator from the pool', async () => {
            const desk = await OTCDesk.deployed();
            await desk.setArbitrationManager(arbitrationManagerAccount, {from: deployAccount});

            await desk.addArbitratorToPool(accounts[1], {from: arbitrationManagerAccount});
            await expect(desk.removeArbitratorFromPool(0, {from: accounts[1]})).to.be.rejected;
            await desk.removeArbitratorFromPool(0, {from: arbitrationManagerAccount});
        });

        it('shouldn’t allow a to remove arbitrator from the empty pool', async () => {
            const desk = await OTCDesk.deployed();
            await desk.setArbitrationManager(arbitrationManagerAccount, {from: deployAccount});

            (await desk.arbitratorsPoolSize()).toNumber().should.be.equal(0);
            await expect(desk.removeArbitratorFromPool(0, {from: arbitrationManagerAccount})).to.be.rejected;
        });

        it('should assign an arbitrator from the pool', async () => {
            let arbitrator1, arbitrator2, arbitrator3;

            const desk = await OTCDesk.deployed();
            await desk.setArbitrationManager(arbitrationManagerAccount, {from: deployAccount});

            await desk.addArbitratorToPool(accounts[1], {from: arbitrationManagerAccount});
            await desk.addArbitratorToPool(accounts[2], {from: arbitrationManagerAccount});
            await desk.addArbitratorToPool(accounts[3], {from: arbitrationManagerAccount});
            (await desk.arbitratorsPoolSize()).toNumber().should.be.equal(3);

            await desk.assignArbitratorFromPool()
                .then(tx => {
                    tx.logs.should.have.length(1);
                    tx.logs[0].event.should.be.equal('ArbitratorAssignment');
                    tx.logs[0].args.deal.should.be.equal(deployAccount);
                    arbitrator1 = tx.logs[0].args.arbitrator;
                    return desk.arbitrators.call(deployAccount)
                        .then(addr => addr.should.be.equal(tx.logs[0].args.arbitrator));
                });

            await desk.assignArbitratorFromPool()
                .then(tx => {
                    tx.logs.should.have.length(1);
                    tx.logs[0].event.should.be.equal('ArbitratorAssignment');
                    tx.logs[0].args.deal.should.be.equal(deployAccount);
                    arbitrator2 = tx.logs[0].args.arbitrator;
                    return desk.arbitrators.call(deployAccount)
                        .then(addr => addr.should.be.equal(tx.logs[0].args.arbitrator));
                });

            await desk.assignArbitratorFromPool()
                .then(tx => {
                    tx.logs.should.have.length(1);
                    tx.logs[0].event.should.be.equal('ArbitratorAssignment');
                    tx.logs[0].args.deal.should.be.equal(deployAccount);
                    arbitrator3 = tx.logs[0].args.arbitrator;
                    return desk.arbitrators.call(deployAccount)
                        .then(addr => addr.should.be.equal(tx.logs[0].args.arbitrator));
                });

            arbitrator1.should.not.be.equal(arbitrator2);
            arbitrator1.should.not.be.equal(arbitrator3);
            arbitrator2.should.not.be.equal(arbitrator3);

            await desk.removeArbitratorFromPool(2, {from: arbitrationManagerAccount});
            await desk.removeArbitratorFromPool(1, {from: arbitrationManagerAccount});
            await desk.removeArbitratorFromPool(0, {from: arbitrationManagerAccount});
        });

        it('should allow the arbitration manager to assign arbitrator', async () => {
            const desk = await OTCDesk.deployed();
            await desk.setArbitrationManager(arbitrationManagerAccount, {from: deployAccount});

            const tx = await desk.assignArbitrator(contractAddress, accounts[1], {from: arbitrationManagerAccount});

            tx.logs.should.have.length(1);
            tx.logs[0].event.should.be.equal('ArbitratorAssignment');
            tx.logs[0].args.deal.should.be.equal(contractAddress);
            tx.logs[0].args.arbitrator.should.be.equal(accounts[1]);
            (await desk.arbitrators.call(contractAddress)).should.be.equal(accounts[1]);
        });

        it('shouldn’t allow a third party to assign arbitrator', async () => {
            const desk = await OTCDesk.deployed();
            await desk.setArbitrationManager(arbitrationManagerAccount, {from: deployAccount});

            await expect(desk.assignArbitrator(contractAddress, accounts[1], {from: accounts[1]})).to.be.rejected;
        });

        it('shouldn’t allow unassigned arbitrator to resolve dispute', async () => {
            const desk = await OTCDesk.deployed();
            await expect(desk.resolveDispute(contractAddress, resolutionHash, web3.utils.toWei('0.33'), {from: accounts[1]}))
                .to.be.rejected;
        });

        it('should allow assigned arbitrator to resolve dispute', async () => {
            const desk = await OTCDesk.deployed();
            await desk.setArbitrationManager(arbitrationManagerAccount, {from: deployAccount});

            const mock = await DealMock.new(desk.address);
            await desk.assignArbitrator(mock.address, accounts[1], {from: arbitrationManagerAccount});

            await expect(desk.resolveDispute(mock.address, resolutionHash, web3.utils.toWei('0.33'), {from: accounts[1]}))
                .to.be.not.rejected;
        });
    });

    it('should create a deal', async () => {
        const desk = await OTCDesk.deployed();

        const tx = await desk.newDeal(
            defaults.hash,
            accounts[1],
            partnerAccount,
            anotherPartnerAccount,
            defaults.price,
            defaults.paymentWindow,
            defaults.buyerIsTaker,
            {value: defaults.price}
        );

        tx.logs.should.have.length(1);
        tx.logs[0].event.should.be.equal('DealCreation');
    });

    it('should issue closeout credit', async () => {
        await web3.eth.sendTransaction({from: deployAccount, to: accountToBeEmpty, value: closeoutCredit});
        await sendAll(accountToBeEmpty, deployAccount, 0);

        const desk = await OTCDesk.deployed();

        await desk.contribute({value: closeoutCredit});
        const deskBalanceBefore = new BigNumber(await web3.eth.getBalance(desk.address));
        const tx = await desk.newDeal(
            defaults.hash,
            accountToBeEmpty,
            partnerAccount,
            anotherPartnerAccount,
            defaults.price,
            defaults.paymentWindow,
            defaults.buyerIsTaker,
            {value: defaults.price}
        );

        tx.logs.should.have.length(2);
        tx.logs[1].event.should.be.equal('CloseoutCreditIssuance');
        tx.logs[1].args.amount.toString().should.be.equal(closeoutCredit);
        deskBalanceBefore.minus(await web3.eth.getBalance(desk.address)).toString().should.be.equal(closeoutCredit);
        (await web3.eth.getBalance(accountToBeEmpty)).should.be.equal(closeoutCredit);
    });


    it('shouldn’t issue closeout credit if there’s no funds', async () => {
        await web3.eth.sendTransaction({from: deployAccount, to: accountToBeEmpty, value: closeoutCredit});
        await sendAll(accountToBeEmpty, deployAccount, 0);

        const desk = await OTCDesk.deployed();

        if (new BigNumber(await web3.eth.getBalance(desk.address)).greaterThan(0)) {
            await desk.withdraw(0);
        }

        const tx = await desk.newDeal(
            defaults.hash,
            accountToBeEmpty,
            partnerAccount,
            anotherPartnerAccount,
            defaults.price,
            defaults.paymentWindow,
            defaults.buyerIsTaker,
            {value: defaults.price}
        );

        tx.logs.should.have.length(1);
        (await web3.eth.getBalance(accountToBeEmpty)).should.be.equal('0');
    });

    it('should issue closeout credit to not empty account with a very small balance', async () => {
        const reducedCredit = new BigNumber(closeoutCredit).sub(888);

        await web3.eth.sendTransaction({from: deployAccount, to: accountToBeEmpty, value: closeoutCredit});
        await sendAll(accountToBeEmpty, deployAccount, 888);

        const desk = await OTCDesk.deployed();

        await desk.contribute({value: reducedCredit});
        const deskBalanceBefore = new BigNumber(await web3.eth.getBalance(desk.address));

        const tx = await desk.newDeal(
            defaults.hash,
            accountToBeEmpty,
            partnerAccount,
            anotherPartnerAccount,
            defaults.price,
            defaults.paymentWindow,
            defaults.buyerIsTaker,
            {value: defaults.price}
        );

        tx.logs.should.have.length(2);
        tx.logs[1].event.should.be.equal('CloseoutCreditIssuance');
        tx.logs[1].args.amount.toString().should.be.equal(reducedCredit.toString());
        deskBalanceBefore.sub(await web3.eth.getBalance(desk.address)).toString().should.be.equal(reducedCredit.toString());
        (await web3.eth.getBalance(accountToBeEmpty)).should.be.equal(closeoutCredit);
    });
});