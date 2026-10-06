// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RwaIntentEscrow} from "../src/RwaIntentEscrow.sol";

contract DeployScript is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address solverAddress = vm.envAddress("SOLVER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        RwaIntentEscrow escrow = new RwaIntentEscrow(usdcAddress, solverAddress);

        vm.stopBroadcast();

        console.log("RwaIntentEscrow deployed to:", address(escrow));
    }
}
