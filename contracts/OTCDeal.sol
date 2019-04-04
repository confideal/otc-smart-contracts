pragma solidity 0.5.4;

import "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import "./OTCDesk.sol";

contract OTCDeal is ReentrancyGuard {
    using SafeMath for uint256;

    uint8 constant public version = 1;

    enum Status {
        Running,
        CloseoutProposed,
        ClosedOut,
        Terminated,
        Arbitration,
        Resolved
    }

    Status public status = Status.Running;
    uint32 public statusTime = uint32(now);
    uint32 public paymentDeadline; // timestamp

    bytes32[] public dataHashes;

    address payable public seller;
    address payable public buyer;
    address public sellerPartner;
    address public buyerPartner;

    uint256 public price;
    uint256 public deskFee;
    uint256 public closeoutCredit;

    bool public isRefundBySellerSet;
    bool public isRefundByBuyerSet;
    bool public sellerAssetSent;
    bool public buyerAssetSent;
    uint256 public refundBySeller;
    uint256 public refundByBuyer;
    uint256 public sellerAsset;
    uint256 public buyerAsset;

    bytes32 public claimHash;

    OTCDesk private desk;

    event PaymentDeadlineProlongation();
    event CloseoutProposition();
    event Closeout();
    event Termination();
    event Arbitration();
    event DisputeResolution();
    event SellerAssetWithdrawal();
    event BuyerAssetWithdrawal();

    constructor(
        bytes32 _dataHash,
        address payable _seller,
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
        deskFee = _price.div(100);

        if (_buyerIsTaker) {
            require(msg.value == _price.add(deskFee));
        } else {
            require(msg.value == _price);
        }

        desk = OTCDesk(msg.sender);

        dataHashes.push(_dataHash);
        seller = _seller;
        buyer = _buyer;
        sellerPartner = _sellerPartner;
        buyerPartner = _buyerPartner;
        price = _price;
        paymentDeadline = uint32(now.add(_paymentWindow));
    }

    function transferCloseoutCredit()
    external
    payable
    nonReentrant
    {
        require(msg.sender == address(desk));
        closeoutCredit = closeoutCredit.add(msg.value);
        require(buyer.send(closeoutCredit));
    }

    function prolong(uint32 _paymentWindow, bytes32 _dataHash)
    external
    {
        require(status == Status.Running);
        require(msg.sender == seller);

        uint32 newDeadline = uint32(now.add(_paymentWindow));
        require(newDeadline >= paymentDeadline);

        dataHashes.push(_dataHash);
        paymentDeadline = newDeadline;
        emit PaymentDeadlineProlongation();
    }

    function terminate()
    external
    nonReentrant
    {
        if (msg.sender == buyer) {
            require(status == Status.Running || status == Status.CloseoutProposed);
        } else {
            require(msg.sender == seller);
            require(status == Status.Running);
            require(paymentDeadline < now);
        }

        emit Termination();
        status = Status.Terminated;
        statusTime = uint32(now);

        sellerAsset = address(this).balance;
        sellerAssetSent = seller.send(sellerAsset);
    }

    function closeOut(uint256 _refund)
    external
    nonReentrant
    {
        require(status == Status.Running || status == Status.CloseoutProposed);
        require(_refund <= address(this).balance.sub(deskFee));

        if (msg.sender == seller) {
            if (_refund > 0) {
                require(!isRefundBySellerSet || _refund != refundBySeller);
                isRefundBySellerSet = true;
                refundBySeller = _refund;
            }
        } else {
            require(msg.sender == buyer);
            require(!isRefundByBuyerSet || _refund != refundByBuyer);
            isRefundByBuyerSet = true;
            refundByBuyer = _refund;
        }

        if (msg.sender == buyer || _refund > 0) {
            emit CloseoutProposition();
            if (status == Status.Running) {
                status = Status.CloseoutProposed;
                statusTime = uint32(now);
            }
        }

        if ((isRefundBySellerSet && isRefundByBuyerSet && refundBySeller == refundByBuyer)
            || (_refund == 0 && msg.sender == seller)) {
            emit Closeout();
            status = Status.ClosedOut;
            statusTime = uint32(now);

            transferAssets(_refund);
        }
    }


    function escalate(bytes32 _claimHash)
    external
    {
        require(msg.sender == seller || msg.sender == buyer);
        require(status == Status.Running || status == Status.CloseoutProposed);

        // paymentDeadline + 2 hours
        require(now >= uint256(paymentDeadline).add(7200));

        claimHash = _claimHash;

        emit Arbitration();
        status = Status.Arbitration;
        statusTime = uint32(now);

        desk.assignArbitratorFromPool();
    }

    function resolveDispute(
        bytes32 _dataHash,
        uint256 _sellerAsset
    )
    external
    nonReentrant
    {
        require(status == Status.Arbitration);
        require(msg.sender == address(desk));
        require(_sellerAsset <= address(this).balance.sub(deskFee));

        emit DisputeResolution();
        status = Status.Resolved;
        statusTime = uint32(now);

        dataHashes.push(_dataHash);

        transferAssets(_sellerAsset);
    }

    function withdrawSellerAsset()
    external
    nonReentrant
    {
        require(status == Status.ClosedOut || status == Status.Terminated || status == Status.Resolved);
        require(msg.sender == seller && sellerAsset > 0 && !sellerAssetSent);

        sellerAssetSent = unsafeTransfer(seller, sellerAsset);
        if (sellerAssetSent) {
            emit SellerAssetWithdrawal();
        }
    }

    function withdrawBuyerAsset()
    external
    nonReentrant
    {
        require(status == Status.ClosedOut || status == Status.Resolved);
        require(msg.sender == buyer && buyerAsset > 0 && !buyerAssetSent);

        buyerAssetSent = unsafeTransfer(buyer, buyerAsset);
        if (buyerAssetSent) {
            emit BuyerAssetWithdrawal();
        }
    }

    function()
    external
    {
        revert();
    }

    function transferAssets(uint256 _sellerAsset)
    private
    {
        sellerAsset = _sellerAsset;
        buyerAsset = address(this).balance.sub(deskFee).sub(sellerAsset);

        uint256 closeoutCreditReturn;
        if (closeoutCredit > 0) {
            if (buyerAsset <= closeoutCredit) {
                closeoutCreditReturn = buyerAsset;
            } else {
                closeoutCreditReturn = closeoutCredit;
            }
            buyerAsset = buyerAsset.sub(closeoutCreditReturn);
        }

        desk.collectFee.value(deskFee.add(closeoutCreditReturn))(closeoutCreditReturn);

        if (sellerAsset > 0) {
            sellerAssetSent = seller.send(sellerAsset);
        }
        if (buyerAsset > 0) {
            buyerAssetSent = buyer.send(buyerAsset);
        }
    }

    function unsafeTransfer(address _recipient, uint256 _amount)
    private
    returns (bool success)
    {
        (success,) = _recipient.call.value(_amount)("");
        return success;
    }
}
