pragma solidity 0.5.4;

import "../OTCDesk.sol";

contract OTCMock {
    bytes32 public resolutionHash;
    uint256 public sellerAsset;

    OTCDesk private desk;

    constructor(OTCDesk _desk)
    public
    {
        desk = _desk;
    }

    function resolveDispute(
        bytes32 _dataHash,
        uint256 _sellerAsset
    )
    external
    {
        resolutionHash = _dataHash;
        sellerAsset = _sellerAsset;
    }

    function pay()
    payable
    external
    {
    }
}