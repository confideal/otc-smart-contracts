pragma solidity 0.5.4;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import "./OTCDeal.sol";

contract OTCDesk is Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    uint8 constant public version = 1;

    address public beneficiary = msg.sender;
    address public arbitrationManager = msg.sender;

    uint256 public confidealFund;

    uint256 public closeoutCredit = 0.0017 ether;

    address[] public arbitratorsPool;

    mapping(address => address) public arbitrators; // deal => arbitrator

    event DealCreation(address deal);
    event FeePayment(address deal, uint256 amount);
    event CloseoutCreditIssuance(address deal, uint256 amount);
    event CloseoutCreditCollection(address deal, uint256 amount);
    event ArbitratorAssignment(address deal, address arbitrator);

    function newDeal(
        bytes32 _dataHash,
        address payable _buyer,
        address _sellerPartner,
        address _buyerPartner,
        uint256 _price,
        uint32 _paymentWindow,
        bool _buyerIsTaker
    )
    public
    payable
    {
        OTCDeal _deal = (new OTCDeal).value(msg.value)(
            _dataHash,
            msg.sender,
            _buyer,
            _sellerPartner,
            _buyerPartner,
            _price,
            _paymentWindow,
            _buyerIsTaker
        );

        emit DealCreation(address(_deal));

        if (_buyer.balance < closeoutCredit) {
            uint256 _closeoutCredit = closeoutCredit.sub(_buyer.balance);
            if (confidealFund >= _closeoutCredit) {
                confidealFund = confidealFund.sub(_closeoutCredit);
                _deal.transferCloseoutCredit.value(_closeoutCredit)();
                emit CloseoutCreditIssuance(address(_deal), _closeoutCredit);
            }
        }
    }

    function setBeneficiary(address _beneficiary)
    external
    onlyOwner
    {
        beneficiary = _beneficiary;
    }

    function setArbitrationManager(address _arbitrationManager)
    external
    onlyOwner
    {
        arbitrationManager = _arbitrationManager;
    }

    function setCloseoutCredit(uint256 _closeoutCredit)
    external
    onlyOwner
    {
        closeoutCredit = _closeoutCredit;
    }

    function collectFee(uint256 _closeoutCreditReturn)
    external
    payable
    {
        uint256 fee = msg.value.sub(_closeoutCreditReturn);
        confidealFund = confidealFund.add(fee);
        emit FeePayment(msg.sender, fee);

        if (_closeoutCreditReturn > 0) {
            confidealFund = confidealFund.add(_closeoutCreditReturn);
            emit CloseoutCreditCollection(msg.sender, _closeoutCreditReturn);
        }
    }

    function arbitratorsPoolSize()
    external
    view
    returns (uint)
    {
        return arbitratorsPool.length;
    }

    function addArbitratorToPool(address _arbitrator)
    external
    {
        require(msg.sender == arbitrationManager);

        arbitratorsPool.push(_arbitrator);
    }

    function removeArbitratorFromPool(uint _index)
    external
    {
        require(msg.sender == arbitrationManager);
        require(arbitratorsPool.length > 0);

        arbitratorsPool[_index] = arbitratorsPool[arbitratorsPool.length - 1];
        arbitratorsPool.pop();
    }

    function assignArbitratorFromPool()
    external
    {
        if (arbitratorsPool.length == 0) {
            return;
        }

        address _arbitrator = arbitratorsPool[block.number % arbitratorsPool.length];
        arbitrators[msg.sender] = _arbitrator;
        emit ArbitratorAssignment(msg.sender, _arbitrator);
    }

    function assignArbitrator(address _deal, address _arbitrator)
    external
    {
        require(msg.sender == arbitrationManager);

        arbitrators[_deal] = _arbitrator;
        emit ArbitratorAssignment(_deal, _arbitrator);
    }

    function resolveDispute(address _deal, bytes32 _dataHash, uint256 _sellerAsset)
    external
    {
        require(msg.sender == arbitrators[_deal]);
        OTCDeal(_deal).resolveDispute(_dataHash, _sellerAsset);
    }

    function withdraw(uint256 _rest)
    external
    {
        require(msg.sender == beneficiary);

        uint256 _amount = confidealFund.sub(_rest);
        require(_amount > 0);

        confidealFund = confidealFund.sub(_amount);
        (bool _successfulTransfer,) = beneficiary.call.value(_amount)("");
        require(_successfulTransfer);
    }

    function contribute()
    external
    payable
    {
        confidealFund = confidealFund.add(msg.value);
    }

    function()
    external
    {
        revert();
    }
}
