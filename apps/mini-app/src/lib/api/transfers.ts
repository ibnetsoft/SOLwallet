import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export interface TransferItem {
  id: string; // transaction signature
  type: 'deposit' | 'withdraw';
  amount: number;
  tokenSymbol: string;
  status: string;
  createdAt: string; // ISO date string
}

export async function getTransferHistory(walletAddress: string, limit = 20): Promise<TransferItem[]> {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const pubkey = new PublicKey(walletAddress);
    
    // Fetch signatures
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit });
    if (signatures.length === 0) return [];

    const sigs = signatures.map((s) => s.signature);
    
    // Fetch parsed transactions
    const txs = await connection.getParsedTransactions(sigs, { maxSupportedTransactionVersion: 0 });
    
    const transfers: TransferItem[] = [];

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const sigInfo = signatures[i];
      if (!tx || !tx.meta) continue;

      let type: 'deposit' | 'withdraw' | null = null;
      let amount = 0;
      let tokenSymbol = 'SOL';

      // 1. Check SPL Token Balances First
      const preToken = tx.meta.preTokenBalances?.find(b => b.owner === walletAddress);
      const postToken = tx.meta.postTokenBalances?.find(b => b.owner === walletAddress);

      if (preToken || postToken) {
        const preAmt = Number(preToken?.uiTokenAmount?.uiAmountString || 0);
        const postAmt = Number(postToken?.uiTokenAmount?.uiAmountString || 0);
        const diff = postAmt - preAmt;

        if (Math.abs(diff) > 0) {
          type = diff > 0 ? 'deposit' : 'withdraw';
          amount = Math.abs(diff);
          
          // Try to guess token symbol from mint if possible, otherwise use generic "Token"
          // We know USDT and USDC mints roughly.
          const mint = preToken?.mint || postToken?.mint;
          if (mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB') tokenSymbol = 'USDT';
          else if (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') tokenSymbol = 'USDC';
          else tokenSymbol = 'Token'; // Fallback
        }
      }

      // 2. If no SPL token change, check SOL change
      if (!type) {
        const accountIndex = tx.transaction.message.accountKeys.findIndex(
          (k) => k.pubkey.toBase58() === walletAddress
        );
        if (accountIndex !== -1) {
          const preBal = tx.meta.preBalances[accountIndex] || 0;
          const postBal = tx.meta.postBalances[accountIndex] || 0;
          const diff = postBal - preBal;
          
          // If difference is exactly the fee, it might just be a transaction fee, not a transfer.
          // But to be safe, if abs(diff) > 5000 lamports (fee is usually 5000) we consider it a transfer.
          // Also, if diff is positive, it's definitely a deposit.
          if (diff > 0) {
            type = 'deposit';
            amount = diff / 1e9;
          } else if (diff < -10000) { // withdrawing more than a standard fee
            type = 'withdraw';
            // subtract standard fee approximation if we want to show exact sent amount, but simple abs is fine
            amount = Math.abs(diff) / 1e9;
          }
        }
      }

      if (type && amount > 0) {
        // We consider this a transfer
        transfers.push({
          id: sigs[i],
          type,
          amount,
          tokenSymbol,
          status: tx.meta.err ? 'failed' : 'completed',
          createdAt: new Date((sigInfo.blockTime || 0) * 1000).toISOString(),
        });
      }
    }

    return transfers;
  } catch (error) {
    console.error('Failed to fetch transfer history:', error);
    return []; // Return empty gracefully
  }
}
