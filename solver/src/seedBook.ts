// Demo utility: seed the (empty) xyz:CL testnet book with the solver's own
// resting GTC orders before recording the intent->fill->settle demo.
// Usage: npm run seed:book -- xyz:CL buy 0.1 80.50
import { restGtcOrder } from "./executor";

const [market, side, sz, px] = process.argv.slice(2);
if (!market || !side || !sz || !px || !["buy", "sell"].includes(side.toLowerCase())) {
    console.error("Usage: npm run seed:book -- <market> <buy|sell> <sz> <px>");
    console.error("Example: npm run seed:book -- xyz:CL buy 0.1 80.50");
    process.exit(1);
}

await restGtcOrder(market, side.toLowerCase() === "buy", sz, px);
console.log("[seedBook] done — verify the book on app.hyperliquid-testnet.xyz before recording");
