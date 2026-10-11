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

    function test_BoundReverts() public {
        RwaIntentEscrow.Intent memory intent = RwaIntentEscrow.Intent({
            user: user,
            market: "xyz:GOLD",
            isLong: true,
            sizeUsd: 500e6,
            deposit: 600e6,
            triggerPrice: 2000e6,
            triggerAbove: true,
            referencePrice: 2000e6,
            maxDeviationBps: 500, // 5% => [1900, 2100]
            expiry: uint64(block.timestamp + 1 days),
            solverFeeBps: 50,
            nonce: 2
        });
        bytes memory sig = signIntent(intent);
        vm.prank(user);
        escrow.createIntent(intent, sig);
        bytes32 id = keccak256(abi.encode(intent));

        // 10% above ref: exceeds the 5% bound
        vm.prank(solver);
        vm.expectRevert("Exceeds max deviation");
        escrow.fillIntent(id, 2200e6);

        // 10% below ref: also exceeds (symmetric bound)
        vm.prank(solver);
        vm.expectRevert("Exceeds max deviation");
        escrow.fillIntent(id, 1800e6);

        // Exactly at the edge: passes
        vm.prank(solver);
        escrow.fillIntent(id, 2100e6);
        assertEq(uint(escrow.intentStatuses(id)), uint(RwaIntentEscrow.Status.FILLED));
    }

    function test_CancelRefunds() public {
        RwaIntentEscrow.Intent memory intent = RwaIntentEscrow.Intent({
            user: user,
            market: "xyz:CL",
            isLong: false,
            sizeUsd: 500e6,
            deposit: 600e6,
            triggerPrice: 60e6,
            triggerAbove: false,
            referencePrice: 65e6,
            maxDeviationBps: 500,
            expiry: uint64(block.timestamp + 1 days),
            solverFeeBps: 50,
            nonce: 3
        });
        bytes memory sig = signIntent(intent);
        vm.prank(user);
        escrow.createIntent(intent, sig);
        bytes32 id = keccak256(abi.encode(intent));

        uint256 userBefore = usdc.balanceOf(user);
        vm.prank(user);
        escrow.cancelIntent(id);

        assertEq(uint(escrow.intentStatuses(id)), uint(RwaIntentEscrow.Status.CANCELLED));
        assertEq(usdc.balanceOf(user), userBefore + 600e6, "full deposit refunded");
    }

    function test_ExpireUnfilledRefunds() public {
        RwaIntentEscrow.Intent memory intent = RwaIntentEscrow.Intent({
            user: user,
            market: "xyz:NVDA",
            isLong: true,
            sizeUsd: 500e6,
            deposit: 600e6,
            triggerPrice: 200e6,
            triggerAbove: true,
            referencePrice: 190e6,
            maxDeviationBps: 500,
            expiry: uint64(block.timestamp + 1 hours),
            solverFeeBps: 50,
            nonce: 4
        });
        bytes memory sig = signIntent(intent);
        vm.prank(user);
        escrow.createIntent(intent, sig);
        bytes32 id = keccak256(abi.encode(intent));

        // Not yet expired: reverts
        vm.expectRevert("Not expired");
        escrow.expireUnfilled(id);

        vm.warp(block.timestamp + 2 hours);
        uint256 userBefore = usdc.balanceOf(user);
        // Anyone can trigger the refund
        vm.prank(solver);
        escrow.expireUnfilled(id);

        assertEq(uint(escrow.intentStatuses(id)), uint(RwaIntentEscrow.Status.EXPIRED));
        assertEq(usdc.balanceOf(user), userBefore + 600e6, "full deposit refunded");
    }

    function test_ReplayProtection() public {
        RwaIntentEscrow.Intent memory intent = RwaIntentEscrow.Intent({
            user: user,
            market: "xyz:GOLD",
            isLong: true,
            sizeUsd: 500e6,
            deposit: 600e6,
            triggerPrice: 2000e6,
            triggerAbove: true,
            referencePrice: 1950e6,
            maxDeviationBps: 500,
            expiry: uint64(block.timestamp + 1 days),
            solverFeeBps: 50,
            nonce: 5
        });
        bytes memory sig = signIntent(intent);
        vm.prank(user);
        escrow.createIntent(intent, sig);

        // Same intent (same nonce) again: reverts
        vm.prank(user);
        vm.expectRevert("Intent already exists");
        escrow.createIntent(intent, sig);
    }

    function test_ShortPosition_Loss() public {
        RwaIntentEscrow.Intent memory intent = RwaIntentEscrow.Intent({
            user: user,
            market: "xyz:CL",
            isLong: false,
            sizeUsd: 500e6,
            deposit: 600e6,
            triggerPrice: 60e6,
            triggerAbove: false,
            referencePrice: 65e6,
            maxDeviationBps: 1000, // 10% => [58.5, 71.5]
            expiry: uint64(block.timestamp + 1 days),
            solverFeeBps: 50, // 2.5e6
            nonce: 6
        });
        bytes memory sig = signIntent(intent);
        vm.prank(user);
        escrow.createIntent(intent, sig);
        bytes32 id = keccak256(abi.encode(intent));

        vm.prank(solver);
        escrow.fillIntent(id, 60e6);

        // Price rises 10% against the short: PnL = 500 * (60-66)/60 = -50
        // Payout = 600 - 50 - 2.5 = 547.5; solver keeps 52.5
        vm.prank(solver);
        escrow.settleIntent(id, 66e6);

        assertEq(usdc.balanceOf(user), 10000e6 - 600e6 + 547500000);
        assertEq(usdc.balanceOf(solver), 10000e6 + 52500000);
    }

    /// @notice Fuzz: the symmetric bound invariant holds for all inputs.
    /// If |entryPrice - ref| * 10000 > maxDeviationBps * ref, fillIntent MUST revert.
    /// If within bounds, fillIntent MUST succeed (all else valid).
    function testFuzz_BoundInvariant(uint256 ref, uint256 entryPrice, uint256 devBps) public {
        // Bound inputs to sane ranges: ref in [$1, $1M], dev in (0, 100%]
        ref = bound(ref, 1e6, 1e12);
        devBps = bound(devBps, 1, 10000);
        // entryPrice in [0, 2x ref] to cover both sides
        entryPrice = bound(entryPrice, 0, ref * 2);

        uint256 nonce = uint256(keccak256(abi.encode(ref, entryPrice, devBps)));
        RwaIntentEscrow.Intent memory intent = RwaIntentEscrow.Intent({
            user: user,
            market: "xyz:GOLD",
            isLong: true,
            sizeUsd: 500e6,
            deposit: 600e6,
            triggerPrice: ref,
            triggerAbove: true,
            referencePrice: ref,
            maxDeviationBps: devBps,
            expiry: uint64(block.timestamp + 1 days),
            solverFeeBps: 50,
            nonce: nonce
        });
        bytes memory sig = signIntent(intent);
        vm.prank(user);
        escrow.createIntent(intent, sig);
        bytes32 id = keccak256(abi.encode(intent));

        uint256 diff = entryPrice > ref ? entryPrice - ref : ref - entryPrice;
        bool withinBound = diff * 10000 <= devBps * ref;

        vm.prank(solver);
        if (withinBound) {
            escrow.fillIntent(id, entryPrice);
            assertEq(uint(escrow.intentStatuses(id)), uint(RwaIntentEscrow.Status.FILLED));
        } else {
            vm.expectRevert("Exceeds max deviation");
            escrow.fillIntent(id, entryPrice);
        }
    }
}
