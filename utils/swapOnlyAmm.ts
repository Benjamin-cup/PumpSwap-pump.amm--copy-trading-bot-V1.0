import assert from 'assert';

import {
  PublicKey,
  Keypair,
  Connection,
  VersionedTransaction
} from '@solana/web3.js';
import { RPC_ENDPOINT } from '../constants';

const solanaConnection = new Connection(RPC_ENDPOINT, "processed");

export const getBuyTxWithJupiter = async (wallet: Keypair, quoteMint: PublicKey, amount: number) => {
  try {
    const quoteResponse = await (
      await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${quoteMint.toBase58()}&amount=${amount}&slippageBps=1000&swapMode=ExactOut`
      )
    ).json();

    // console.log("🚀 ~ getBuyTxWithJupiter ~ quoteResponse:", quoteResponse)
    // get serialized transactions for the swap
    const { swapTransaction } = await (
      await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 52000
        }),
      })
    ).json();


    if (swapTransaction === null) {
      console.log("Jupiter aggregator don't support this token.")
    }
    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // sign the transaction
    transaction.sign([wallet]);
    console.log(await solanaConnection.simulateTransaction(transaction, { sigVerify: true }))
    return transaction
  } catch (error) {
    console.log("Failed to get buy transaction")
    console.log(error)
    return null
  }
};


export const getSellTxWithJupiter = async (wallet: Keypair, baseMint: PublicKey, amount: number) => {
  try {
    const quoteResponse = await (
      await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${baseMint.toBase58()}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=1000`
      )
    ).json();
    // console.log("🚀 ~ getSellTxWithJupiter ~ quoteResponse:", quoteResponse)

    // get serialized transactions for the swap
    const { swapTransaction } = await (
      await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 52000
        }),
      })
    ).json();

    if (swapTransaction === null) {
      console.log("Jupiter aggregator don't support this token.")
    }
    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // sign the transaction
    transaction.sign([wallet]);
    console.log(await solanaConnection.simulateTransaction(transaction, { sigVerify: true }))
    return transaction
  } catch (error) {
    console.log("Failed to get sell transaction")
    console.log(error)
    return null
  }
};