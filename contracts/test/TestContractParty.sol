pragma solidity 0.5.4;

import "../OTCDesk.sol";

contract TestContractParty {
    OTCDesk private desk;

    constructor(OTCDesk _desk)
    public
    {
        desk = _desk;
    }

    function createContract(
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
        desk.newDeal.value(msg.value)(
            _dataHash,
            _buyer,
            _sellerPartner,
            _buyerPartner,
            _price,
            _paymentWindow,
            _buyerIsTaker
        );
    }

    function terminate(OTCDeal _contract)
    external
    {
        _contract.terminate();
    }

    function closeOut(OTCDeal _contract, uint256 _refund)
    external
    {
        _contract.closeOut(_refund);
    }

    function withdrawSellerAsset(OTCDeal _contract)
    external
    {
        _contract.withdrawSellerAsset();
    }

    function withdrawBuyerAsset(OTCDeal _contract)
    external
    {
        _contract.withdrawBuyerAsset();
    }

    function pay()
    payable
    external
    {
        // just receives payments
    }

    function()
    payable
    external
    {
        for (uint i; i < 100; i++) {}
    }
}
