import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { buyDerivePoolKeys, fetchMarketId, getPoolID, makeDerivePoolKeys, sellderivePoolKeys } from "./poolAll";
import { RPC_ENDPOINT, SOL_MINT, PRIVATE_KEY } from "../../constants";
import { bufferRing } from "../streaming/openbook"
import { LiquidityPoolKeysV4, LiquidityStateV4, MARKET_STATE_LAYOUT_V3 } from "@raydium-io/raydium-sdk";
import { buy, sell } from "../transaction/transaction";
import bs58 from "bs58"
import { logger } from "../../utils";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getPoolState } from "./getPoolInfo";

const solanaConnection = new Connection(RPC_ENDPOINT, 'confirmed');
const secretKey = bs58.decode(PRIVATE_KEY);
const keypair = Keypair.fromSecretKey(secretKey);

export async function buyTokenRaydium(tokenMint: string, solAmount: number, poolId: string, marketId: string, tokenDecimal: number) {
    try {
        logger.info('Start getting poolKey');
        console.log("solAmount=====>", solAmount)
        let poolKey = await buyDerivePoolKeys(new PublicKey(poolId), new PublicKey(marketId), new PublicKey(tokenMint), tokenDecimal);
        console.log("poolKey========>", poolKey);
        logger.info('Finish getting poolKey');

        if (!poolKey) {
            console.log("poolKey is null. Exiting function.");
            return;
        }

        logger.info('Start buy');

        await buy(new PublicKey(tokenMint), poolKey, solAmount);

        logger.info('Finish buy');

    } catch (error) {
        console.log(error)
    }
}


export async function sellTokenRaydium(tokenMint: string, poolId: string, marketId: string, tokenDecimal: number, tokenRaydiumSellAmount: number) {
    try {

        console.log("tokenRaydiumSellAmount===========>", tokenRaydiumSellAmount);
        logger.info('Start getting poolKey');

        let poolKey = await sellderivePoolKeys(new PublicKey(poolId), new PublicKey(marketId), new PublicKey(tokenMint), tokenDecimal);
        console.log("poolKey========>", poolKey);
        logger.info('Finish getting poolKey');

        let tokenAmount = tokenRaydiumSellAmount * 10 ** tokenDecimal
        if (!poolKey) {
            console.log("poolKey is null. Exiting function.");
            return;
        }

        logger.info('Start sell');
        logger.info('Start getting token ata');
        const ata = getAssociatedTokenAddressSync(new PublicKey(tokenMint), keypair.publicKey);
        console.log("ata====================>", ata)
        logger.info('Finish getting token ata');

        await sell({ mint: new PublicKey(tokenMint), address: ata }, poolKey, tokenAmount);
        logger.info('Finish sell');
    } catch (error) {
        console.log("Sell Token Error:", error);
    }
}



export async function buyTokenRaydiumWithMint(tokenMint: string, poolId: string, tokenDecimal: number, solAmount: number) {
    try {
        logger.info('Start getting poolKey');

        let poolState = await getPoolState(solanaConnection, new PublicKey(tokenMint));
        // console.log("marketId========>", poolState);
        logger.info('Finish getting marketId');

        if (!poolState) {
            console.log("PoolState is null. Exiting function.");
            return;
        }

        let poolKey = await makeDerivePoolKeys(new PublicKey(poolId), poolState, new PublicKey(tokenMint), tokenDecimal);
        // console.log("poolKey========>", poolKey);
        logger.info('Finish getting poolKey');

        if (!poolKey) {
            console.log("poolKey is null. Exiting function.");
            return;
        }

        logger.info('Start buy');

        await buy(new PublicKey(tokenMint), poolKey, solAmount);

        logger.info('Finish buy');

    } catch (error) {
        console.log(error)
    }
}


export async function sellTokenRaydiumWithMint(tokenMint: string, poolId: string, tokenDecimal: number, tokenRaydiumSellAmount: number) {
    try {

        logger.info('Start getting poolKey');

        let poolState = await getPoolState(solanaConnection, new PublicKey(tokenMint));
        // console.log("marketId========>", poolState);
        logger.info('Finish getting marketId');

        if (!poolState) {
            console.log("PoolState is null. Exiting function.");
            return;
        }

        let poolKey = await makeDerivePoolKeys(new PublicKey(poolId), poolState, new PublicKey(tokenMint), tokenDecimal);
        // console.log("poolKey========>", poolKey);
        logger.info('Finish getting poolKey');

        let tokenAmount = tokenRaydiumSellAmount * 10 ** tokenDecimal
        if (!poolKey) {
            console.log("poolKey is null. Exiting function.");
            return;
        }

        logger.info('Start sell');
        logger.info('Start getting token ata');
        const ata = getAssociatedTokenAddressSync(new PublicKey(tokenMint), keypair.publicKey);
        console.log("ata====================>", ata)
        logger.info('Finish getting token ata');

        await sell({ mint: new PublicKey(tokenMint), address: ata }, poolKey, tokenAmount);
        logger.info('Finish sell');
    } catch (error) {
        console.log("Sell Token Error:", error);
    }
}