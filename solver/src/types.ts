export interface Intent {
    id: string; // The bytes32 hash of the intent from the contract
    user: string;
    market: string;
    isLong: boolean;
    sizeUsd: bigint;
    deposit: bigint;
    triggerPrice: bigint;
    triggerAbove: boolean;
    referencePrice: bigint;
    maxDeviationBps: bigint;
    expiry: number;
    solverFeeBps: bigint;
    nonce: bigint;
}
