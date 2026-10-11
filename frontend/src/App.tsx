import { useState, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useWriteContract, useSignTypedData } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseUnits } from 'viem'
import { IntentsList } from './components/IntentsList'
import { ESCROW_ADDRESS, USDC_ADDRESS } from './escrow'
import './App.css'

const DOMAIN = {
  name: "AfterHours",
  version: "1",
  chainId: 84532, // Base Sepolia
  verifyingContract: ESCROW_ADDRESS as `0x${string}`
} as const;

const TYPES = {
  Intent: [
    { name: 'user', type: 'address' },
    { name: 'market', type: 'string' },
    { name: 'isLong', type: 'bool' },
    { name: 'sizeUsd', type: 'uint256' },
    { name: 'deposit', type: 'uint256' },
    { name: 'triggerPrice', type: 'uint256' },
    { name: 'triggerAbove', type: 'bool' },
    { name: 'referencePrice', type: 'uint256' },
    { name: 'maxDeviationBps', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'solverFeeBps', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ]
} as const;

function App() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()

  // Form State
  const [market, setMarket] = useState("xyz:GOLD")
  const [isLong, setIsLong] = useState(true)
  const [sizeUsd, setSizeUsd] = useState("500")
  const [triggerPrice, setTriggerPrice] = useState("")
  const [triggerAbove, setTriggerAbove] = useState(true)
  const [referencePrice, setReferencePrice] = useState("")
  const [maxDeviationBps, setMaxDeviationBps] = useState("500") // 5%
  const [expiryHours, setExpiryHours] = useState("24")
  const [tab, setTab] = useState<"create" | "intents">("create")
  const solverFeeBps = 50n // 0.5% default

  // Fetch Live Mid Price
  useEffect(() => {
    async function fetchMid() {
      try {
        const res = await fetch("https://api.hyperliquid-testnet.xyz/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "l2Book", coin: market })
        });
        const data = await res.json();
        if (data && data.levels) {
          const bid = parseFloat(data.levels[0][0].px);
          const ask = parseFloat(data.levels[1][0].px);
          const mid = (bid + ask) / 2;
          setReferencePrice(mid.toFixed(4));
          // If trigger not set, set it 1% away based on side
          if (!triggerPrice) {
            setTriggerPrice((mid * (isLong ? 1.01 : 0.99)).toFixed(4));
          }
        }
      } catch (err) {
        console.error("Failed to fetch HL book", err);
      }
    }
    fetchMid();
  }, [market]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;

    try {
      const sizeUsdBigInt = parseUnits(sizeUsd, 6);
      const fee = (sizeUsdBigInt * solverFeeBps) / 10000n;
      const deposit = sizeUsdBigInt + fee; 
      
      const intent = {
        user: address,
        market,
        isLong,
        sizeUsd: sizeUsdBigInt,
        deposit,
        triggerPrice: parseUnits(triggerPrice, 6),
        triggerAbove,
        referencePrice: parseUnits(referencePrice, 6),
        maxDeviationBps: BigInt(maxDeviationBps),
        expiry: BigInt(Math.floor(Date.now() / 1000) + Number(expiryHours) * 3600),
        solverFeeBps,
        nonce: BigInt(Date.now()) // Simple nonce
      };

      console.log("Signing...", intent);
      const signature = await signTypedDataAsync({
        domain: DOMAIN,
        types: TYPES,
        primaryType: 'Intent',
        message: intent,
      });

      console.log("Signature:", signature);

      // 1. Approve USDC
      await writeContractAsync({
        address: USDC_ADDRESS as `0x${string}`,
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }],
        functionName: 'approve',
        args: [ESCROW_ADDRESS as `0x${string}`, deposit],
      });

      // 2. Create Intent
      await writeContractAsync({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: [{ name: 'createIntent', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'intent', type: 'tuple', components: TYPES.Intent }, { name: 'sig', type: 'bytes' }], outputs: [] }],
        functionName: 'createIntent',
        args: [intent, signature],
      });

      alert("Intent successfully created!");
    } catch (err) {
      console.error(err);
      alert("Error creating intent. See console.");
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>AfterHours 🌙</h1>
        {isConnected ? (
          <div className="wallet-chip">
            <span className="address">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            <button className="btn-secondary outline" onClick={() => disconnect()}>Disconnect</button>
          </div>
        ) : (
          <button className="btn-primary" onClick={() => connect({ connector: injected() })}>Connect Wallet</button>
        )}
      </header>

      <main>
        <section className="hero">
          <h2>Trade 24/7 RWA perps from Base</h2>
          <p>Set conditional orders that automatically execute on Hyperliquid when price targets are hit. Zero bridging required.</p>
        </section>

        {isConnected && (
          <div className="tabs">
            <button
              className={`tab ${tab === "create" ? "active" : ""}`}
              onClick={() => setTab("create")}
            >
              Create Intent
            </button>
            <button
              className={`tab ${tab === "intents" ? "active" : ""}`}
              onClick={() => setTab("intents")}
            >
              My Intents
            </button>
          </div>
        )}

        {isConnected && tab === "intents" && <IntentsList userAddress={address} />}

        {isConnected && tab === "create" && (
          <form className="intent-form card" onSubmit={handleSubmit}>
            <h3>Create Intent</h3>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="market">Market</label>
                <select id="market" value={market} onChange={(e) => setMarket(e.target.value)}>
                  <option value="xyz:GOLD">Gold (xyz:GOLD)</option>
                  <option value="xyz:CL">Crude Oil (xyz:CL)</option>
                  <option value="xyz:NVDA">Nvidia (xyz:NVDA)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Side</label>
                <div className="toggle-group">
                  <button type="button" className={`toggle-btn ${isLong ? 'active long' : ''}`} onClick={() => setIsLong(true)}>Long</button>
                  <button type="button" className={`toggle-btn ${!isLong ? 'active short' : ''}`} onClick={() => setIsLong(false)}>Short</button>
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="sizeUsd">Size (USDC)</label>
                <input id="sizeUsd" type="number" min="10" step="1" required value={sizeUsd} onChange={(e) => setSizeUsd(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="referencePrice">Reference Price</label>
                <input id="referencePrice" type="number" step="0.0001" required value={referencePrice} onChange={(e) => setReferencePrice(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="triggerPrice">Trigger Price</label>
                <input id="triggerPrice" type="number" step="0.0001" required value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="triggerAbove">Trigger Condition</label>
                <select id="triggerAbove" value={triggerAbove ? "above" : "below"} onChange={(e) => setTriggerAbove(e.target.value === "above")}>
                  <option value="above">When price ≥ Trigger</option>
                  <option value="below">When price ≤ Trigger</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="maxDeviationBps">Max Deviation (bps)</label>
                <input id="maxDeviationBps" type="number" min="1" max="10000" required value={maxDeviationBps} onChange={(e) => setMaxDeviationBps(e.target.value)} />
                <small className="hint">100 bps = 1%</small>
              </div>
              <div className="form-group">
                <label htmlFor="expiryHours">Expiry Time</label>
                <select id="expiryHours" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)}>
                  <option value="1">1 Hour</option>
                  <option value="24">24 Hours</option>
                  <option value="72">72 Hours (Weekend)</option>
                </select>
              </div>
            </div>

            <div className="summary-box">
              <div className="summary-row">
                <span>Solver Fee (0.5%):</span>
                <span>${(Number(sizeUsd) * 0.005).toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Max Loss (Deposit):</span>
                <span>${(Number(sizeUsd) + Number(sizeUsd) * 0.005).toFixed(2)}</span>
              </div>
              <div className="summary-row bound">
                <span>Fill bound (±{(Number(maxDeviationBps) / 100).toFixed(1)}%):</span>
                <span>
                  ${(Number(referencePrice) * (1 - Number(maxDeviationBps) / 10000)).toFixed(4)} – $
                  {(Number(referencePrice) * (1 + Number(maxDeviationBps) / 10000)).toFixed(4)}
                </span>
              </div>
            </div>

            <button type="submit" className="btn-primary full-width submit-btn">
              Sign & Deposit ${ (Number(sizeUsd) + Number(sizeUsd) * 0.005).toFixed(2) }
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

export default App
