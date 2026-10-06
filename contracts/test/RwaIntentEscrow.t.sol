// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {RwaIntentEscrow} from "../src/RwaIntentEscrow.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RwaIntentEscrowTest is Test {
    RwaIntentEscrow public escrow;
    MockUSDC public usdc;

    uint256 solverKey = 0x1234;
    address solver = vm.addr(solverKey);

    uint256 userKey = 0x5678;
    address user = vm.addr(userKey);

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new RwaIntentEscrow(address(usdc), solver);
        
        usdc.mint(user, 10000e6);
        vm.prank(user);
        usdc.approve(address(escrow), type(uint256).max);

        usdc.mint(solver, 10000e6);
        vm.prank(solver);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function signIntent(RwaIntentEscrow.Intent memory intent) internal view returns (bytes memory) {
        bytes32 DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AfterHours")),
                keccak256(bytes("1")),
                block.chainid,
                address(escrow)
            )
        );
        bytes32 structHash = escrow.hashIntent(intent);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_CreateAndFillIntent_Long_Win() public {
        RwaIntentEscrow.Intent memory intent = RwaIntentEscrow.Intent({
            user: user,
            market: "xyz:GOLD",
            isLong: true,
            sizeUsd: 500e6,
            deposit: 600e6,
            triggerPrice: 2000e6,
            triggerAbove: true,
            referencePrice: 1950e6,
            maxDeviationBps: 500, // 5% limit above 1950 is 2047.5
            expiry: uint64(block.timestamp + 1 days),
            solverFeeBps: 50, // 0.5% = 2.5e6
            nonce: 1
        });

        bytes memory sig = signIntent(intent);

        vm.prank(user);
        escrow.createIntent(intent, sig);

        bytes32 id = keccak256(abi.encode(intent));
        assertEq(uint(escrow.intentStatuses(id)), uint(RwaIntentEscrow.Status.OPEN));
        assertEq(usdc.balanceOf(address(escrow)), 600e6);

        // Fill at 2000
        vm.prank(solver);
        escrow.fillIntent(id, 2000e6);

        assertEq(uint(escrow.intentStatuses(id)), uint(RwaIntentEscrow.Status.FILLED));
        assertEq(escrow.entryPrices(id), 2000e6);

        // Settle at 2020 (+1% move)
        // PnL = 500 * (2020-2000)/2000 = 5.
        // Payout = 600 + 5 - 2.5 = 602.5
        vm.prank(solver);
        escrow.settleIntent(id, 2020e6);

        assertEq(uint(escrow.intentStatuses(id)), uint(RwaIntentEscrow.Status.SETTLED));
        assertEq(usdc.balanceOf(user), 10000e6 - 600e6 + 602500000); // 10002.5 USDC
        assertEq(usdc.balanceOf(solver), 10000e6 - 2500000); // Solver pays 2.5 net (5 PnL - 2.5 fee)
    }
}
