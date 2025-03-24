import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionMessage } from "@solana/web3.js";
import { createCloseAccountInstruction, getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import base58 from "bs58";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { PumpFunSDK } from "../src/src/pumpfun";
import { AnchorProvider, web3 } from "@coral-xyz/anchor";

import dotenv from 'dotenv'
import { PRIVATE_KEY, RPC_ENDPOINT, SELL_PERCENT, SET_COMPUTE_UNIT_LIMIT, SET_COMPUTE_UNITPRICE, PUMPFUN_SELL_SLIPPAGE } from "../../constants";
import { executeJitoTx } from "../utils/jito";
import { logger } from "../src/utils";
import { executeJitoTx1 } from "../utils/sellJito";
import { sendBundle } from "../../utils/liljit";
dotenv.config()


const commitment = "confirmed"
const solanaConnection = new Connection(RPC_ENDPOINT, 'processed');
let sdk = new PumpFunSDK(new AnchorProvider(solanaConnection, new NodeWallet(new Keypair()), { commitment }));
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))


const sellTokenPumpfun = async (mint: PublicKey, sellTokenAmount: number) => {

    try {

        let tx: Transaction;
        logger.info('Start sell transaction');

        logger.info('Start get token ata');
        const tokenAta = await getAssociatedTokenAddress(mint, mainKp.publicKey, false);
        logger.info('Finish get token ata');

        const tokenAccountInfo = await getAccount(solanaConnection, tokenAta);

        const realTokenBalance = Math.floor(Number(tokenAccountInfo.amount) * (SELL_PERCENT / 100));

        // Fetch the token balance after ensuring the account exists
        const tokenBalance = realTokenBalance.toString();
        logger.info(`Token balance for ${mint.toString()} is: ${tokenBalance}`);

        if (tokenBalance === '0') {
            logger.info({ mint: mint.toString() }, `Empty balance, can't sell`);
            return;
        }

        logger.info('Start make sell instruction');
        const tokenSellix = await makeSellIx(mainKp, Number(tokenBalance), mint);
        logger.info('Finish make sell instruction');

        console.log(tokenSellix);
        if (!tokenSellix) {
            console.log("Token buy instruction not retrieved")
            return
        }
        logger.info('Start building sell transactions');


        if (SELL_PERCENT == 100) {

            tx = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: SET_COMPUTE_UNITPRICE,
                }),
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: SET_COMPUTE_UNIT_LIMIT,
                }),
                tokenSellix,
                createCloseAccountInstruction(tokenAta, mainKp.publicKey, mainKp.publicKey)

            )

        } else {
            tx = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: SET_COMPUTE_UNITPRICE,
                }),
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: SET_COMPUTE_UNIT_LIMIT,
                }),
                tokenSellix,

            )

        }

        tx.feePayer = mainKp.publicKey
        const latestBlockhash = await solanaConnection.getLatestBlockhash();
        tx.recentBlockhash = latestBlockhash.blockhash

        const messageV0 = new TransactionMessage({
            payerKey: mainKp.publicKey,
            recentBlockhash: tx.recentBlockhash,
            instructions: tx.instructions,
        }).compileToV0Message()

        const versionedTx = new web3.VersionedTransaction(messageV0);
        versionedTx.sign([mainKp]);
        console.log(await solanaConnection.simulateTransaction(versionedTx, { sigVerify: true }))
        logger.info('Finish building sell transactions');

        logger.info('Start send and confirm sell transactions');
        const jitoResult = executeJitoTx([versionedTx], mainKp, 'processed', latestBlockhash);
        // const jitoResult = await sendBundle([versionedTx], mainKp, 'processed', latestBlockhash);


        if (jitoResult) {
            return jitoResult
        }
        logger.info('Finish sell transactions');

        console.log("======================== Token Sell end ==========================", '\n')
        // return true

        // const txSig = await executeJitoTx1([versionedTx], mainKp, "confirmed");
        // console.log(`✅ Successfully swapped tokens. Transaction Signature: ${txSig}`);
        // if (txSig) {
        //     return txSig
        // }

    } catch (error) {
        console.log("======================== Token Sell fail ==========================", '\n')
        console.log(error)
        return false
    }

}

// make sell instructions
const makeSellIx = async (kp: Keypair, sellAmount: number, mint: PublicKey) => {
    let sellIx = await sdk.getSellInstructionsByTokenAmount(
        kp.publicKey,
        mint,
        BigInt(sellAmount),
        BigInt(PUMPFUN_SELL_SLIPPAGE),
        commitment
    );

    console.log("Sellamount:", sellAmount);

    return sellIx
}


export default sellTokenPumpfun;