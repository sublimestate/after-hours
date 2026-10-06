import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

function App() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>AfterHours</h1>
      <p>Trade Hyperliquid's 24/7 RWA perps from Base.</p>
      
      {isConnected ? (
        <div>
          <p>Connected: {address}</p>
          <button onClick={() => disconnect()}>Disconnect</button>
        </div>
      ) : (
        <button onClick={() => connect({ connector: injected() })}>
          Connect Wallet
        </button>
      )}

      {isConnected && (
        <div style={{ marginTop: '2rem' }}>
          <h2>Create Intent</h2>
          <p>Coming soon...</p>
        </div>
      )}
    </div>
  )
}

export default App
