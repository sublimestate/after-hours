// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

contract RwaIntentEscrow is EIP712 {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable solver;

    struct Intent {
        address user;
        string  market;
        bool    isLong;
        uint256 sizeUsd;
        uint256 deposit;
        uint256 triggerPrice;
        bool    triggerAbove;
        uint256 referencePrice;
        uint256 maxDeviationBps;
        uint64  expiry;
        uint256 solverFeeBps;
        uint256 nonce;
    }

    enum Status { OPEN, FILLED, SETTLED, CANCELLED, EXPIRED }

    mapping(bytes32 => Intent) public intents;
    mapping(bytes32 => Status) public intentStatuses;
    mapping(bytes32 => uint256) public entryPrices;
    mapping(bytes32 => bool) public usedIds;

    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "Intent(address user,string market,bool isLong,uint256 sizeUsd,uint256 deposit,uint256 triggerPrice,bool triggerAbove,uint256 referencePrice,uint256 maxDeviationBps,uint64 expiry,uint256 solverFeeBps,uint256 nonce)"
    );

    event IntentCreated(bytes32 indexed id, Intent intent);
    event IntentCancelled(bytes32 indexed id);
    event IntentFilled(bytes32 indexed id, uint256 entryPrice);
    event IntentSettled(bytes32 indexed id, uint256 exitPrice, int256 pnl, uint256 fee);
    event IntentExpired(bytes32 indexed id);

    constructor(address _usdc, address _solver) EIP712("AfterHours", "1") {
        usdc = IERC20(_usdc);
        solver = _solver;
    }

    function hashIntent(Intent memory intent) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                intent.user,
                keccak256(bytes(intent.market)),
                intent.isLong,
                intent.sizeUsd,
                intent.deposit,
                intent.triggerPrice,
                intent.triggerAbove,
                intent.referencePrice,
                intent.maxDeviationBps,
                intent.expiry,
                intent.solverFeeBps,
                intent.nonce
            )
        );
    }

    function createIntent(Intent calldata i, bytes calldata sig) external {
        bytes32 structHash = hashIntent(i);
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, sig);
        
        require(signer == i.user, "Invalid signature");
        require(i.expiry > block.timestamp, "Expiry in past");
        require(i.sizeUsd > 0, "Zero size");
        require(i.deposit >= i.sizeUsd + (i.sizeUsd * i.solverFeeBps) / 10000, "Deposit too small");
        
        bytes32 id = keccak256(abi.encode(i));
        require(!usedIds[id], "Intent already exists");
        usedIds[id] = true;

        intents[id] = i;
        intentStatuses[id] = Status.OPEN;

        usdc.safeTransferFrom(i.user, address(this), i.deposit);

        emit IntentCreated(id, i);
    }

    function cancelIntent(bytes32 id) external {
        Intent memory i = intents[id];
        require(msg.sender == i.user, "Not owner");
        require(intentStatuses[id] == Status.OPEN, "Not open");

        intentStatuses[id] = Status.CANCELLED;
        usdc.safeTransfer(i.user, i.deposit);

        emit IntentCancelled(id);
    }

    function fillIntent(bytes32 id, uint256 entryPrice) external {
        require(msg.sender == solver, "Not solver");
        require(intentStatuses[id] == Status.OPEN, "Not open");
        
        Intent memory i = intents[id];
        require(block.timestamp < i.expiry, "Expired");

        uint256 ref = i.referencePrice;
        if (i.isLong) {
            require(entryPrice <= ref + (ref * i.maxDeviationBps / 10000), "Exceeds max deviation");
        } else {
            require(entryPrice >= ref - (ref * i.maxDeviationBps / 10000), "Exceeds max deviation");
        }

        entryPrices[id] = entryPrice;
        intentStatuses[id] = Status.FILLED;

        emit IntentFilled(id, entryPrice);
    }

    function settleIntent(bytes32 id, uint256 exitPrice) external {
        require(msg.sender == solver, "Not solver");
        require(intentStatuses[id] == Status.FILLED, "Not filled");

        Intent memory i = intents[id];
        uint256 entryP = entryPrices[id];

        int256 pnl;
        if (i.isLong) {
            pnl = (int256(i.sizeUsd) * (int256(exitPrice) - int256(entryP))) / int256(entryP);
        } else {
            pnl = (int256(i.sizeUsd) * (int256(entryP) - int256(exitPrice))) / int256(entryP);
        }

        uint256 fee = (i.sizeUsd * i.solverFeeBps) / 10000;
        int256 payoutInt = int256(i.deposit) + pnl - int256(fee);
        require(payoutInt >= 0, "Negative payout");
        uint256 payout = uint256(payoutInt);

        intentStatuses[id] = Status.SETTLED;

        if (payout > i.deposit) {
            uint256 solverOwes = payout - i.deposit;
            usdc.safeTransferFrom(msg.sender, i.user, solverOwes);
            usdc.safeTransfer(i.user, i.deposit);
        } else {
            usdc.safeTransfer(i.user, payout);
            uint256 remaining = i.deposit - payout;
            if (remaining > 0) {
                usdc.safeTransfer(solver, remaining);
            }
        }

        emit IntentSettled(id, exitPrice, pnl, fee);
    }

    function expireUnfilled(bytes32 id) external {
        require(intentStatuses[id] == Status.OPEN, "Not open");
        Intent memory i = intents[id];
        require(block.timestamp >= i.expiry, "Not expired");

        intentStatuses[id] = Status.EXPIRED;
        usdc.safeTransfer(i.user, i.deposit);

        emit IntentExpired(id);
    }
}
