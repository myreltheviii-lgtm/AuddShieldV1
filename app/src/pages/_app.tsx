import type { AppProps } from "next/app";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  BackpackWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { Toaster } from "react-hot-toast";
import "../styles/globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";

// Use devnet for all development. Switch endpoint to mainnet-beta for production.
const ENDPOINT = process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet");

export default function App({ Component, pageProps }: AppProps) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BackpackWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Component {...pageProps} />
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#1A1E2A",
                color: "#E2E8F4",
                border: "1px solid #252B3B",
                borderRadius: "12px",
                fontSize: "13px",
              },
              success: { iconTheme: { primary: "#00D4AA", secondary: "#0D1117" } },
              error:   { iconTheme: { primary: "#FF4D6D", secondary: "#0D1117" } },
            }}
          />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
