
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Token, TokenAmount, Percent } from '@raydium-io/raydium-sdk';
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import Client from '@triton-one/yellowstone-grpc';
import dotenv from 'dotenv'
import bs58 from 'bs58';

import { createPoolKeys, getTokenAccounts } from "../liquidity";
import { MinimalMarketLayoutV3 } from '../market';
import { executeJitoTx } from '../../utils/jito';
import { sleep } from '../../utils/commonFunc';
import { logger } from '../../utils/logger';
import {
    BUY_LIMIT,
    COMMITMENT_LEVEL,
    LOG_LEVEL,
    PRIVATE_KEY,
    QUOTE_AMOUNT,
    QUOTE_MINT,
    RPC_ENDPOINT,
    RPC_WEBSOCKET_ENDPOINT,
    SELL_PERCENT,
    SET_COMPUTE_UNITPRICE,
    SET_COMPUTE_UNIT_LIMIT,

} from "../../constants";
import { sendAndConfirmTransaction } from '@solana/web3.js';
import { executeJitoTx1 } from '../../utils/selljito';
import { getSellTxWithJupiter } from '../../utils';

dotenv.config()

let wallet: Keypair;
let quoteToken: Token;
let quoteTokenAssociatedAddress: PublicKey;
let quoteAmount: TokenAmount;
const keypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));

wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);

export interface MinimalTokenAccountData {
    mint: PublicKey;
    address: PublicKey;
    poolKeys?: LiquidityPoolKeysV4;
    market?: LiquidityStateV4;
};

const existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();

// Constants
const ENDPOINT = process.env.GRPC_ENDPOINT!;
const TOKEN = process.env.GRPC_TOKEN!;

const client = new Client(ENDPOINT, TOKEN, {});

const solanaConnection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});
const stakeConnection = new Connection(RPC_ENDPOINT!, 'processed')

const AMOUNT_TO_WSOL = parseFloat(process.env.AMOUNT_TO_WSOL || '0.005');
const AUTO_SELL = process.env.AUTO_SELL === 'true';
const SELL_TIMER = parseInt(process.env.SELL_TIMER || '10000', 10);
const MAX_RETRY = parseInt(process.env.MAX_RETRY || '10', 10);
const SLIPPAGE = parseFloat(process.env.SLIPPAGE || '0.005');

// Init Function
export async function init(): Promise<void> {
    logger.level = LOG_LEVEL;

    // Get wallet
    wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    logger.info(`Wallet Address: ${wallet.publicKey}`);

    // Handle quote token based on QUOTE_MINT (WSOL or USDC)
    switch (QUOTE_MINT) {
        case 'WSOL': {
            quoteToken = Token.WSOL;
            quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);
            logger.info('Quote token is WSOL');
            break;
        }
        case 'USDC': {
            quoteToken = new Token(
                TOKEN_PROGRAM_ID,
                new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
                6,
                'USDC',
                'USDC',
            );
            quoteAmount = new TokenAmount(quoteToken, QUOTE_AMOUNT, false);
            logger.info('Quote token is USDC');
            break;
        }
        default: {
            throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
        }
    }

    logger.info(
        `Script will buy all new tokens using ${QUOTE_MINT}. Amount that will be used to buy each token is: ${quoteAmount.toFixed().toString()}`
    );

    // Display AUTO_SELL & SELL_TIMER
    logger.info(`AUTO_SELL: ${AUTO_SELL}`);
    logger.info(`SELL_TIMER: ${SELL_TIMER}`);
    logger.info(`SLIPPAGE: ${SLIPPAGE}`);
    logger.info(`AMOUNT_TO_WSOL: ${AMOUNT_TO_WSOL}`);
    logger.info(`MAX_RETRY: ${MAX_RETRY}`);
    logger.info(`CHECK_IF_FREEZABLE: ${process.env.CHECK_IF_FREEZABLE}`);

    // Check existing wallet for associated token account of quote mint
    const tokenAccounts = await getTokenAccounts(solanaConnection, wallet.publicKey, COMMITMENT_LEVEL);
    logger.info('Fetched token accounts from wallet.');

    // Create WSOL ATA and fund it with SOL during initialization
    if (QUOTE_MINT === 'WSOL') {
        const wsolAta = getAssociatedTokenAddressSync(Token.WSOL.mint, wallet.publicKey);
        logger.info(`WSOL ATA: ${wsolAta.toString()}`);

        // Check if WSOL account exists in wallet
        const solAccount = tokenAccounts.find(
            (acc) => acc.accountInfo.mint.toString() === Token.WSOL.mint.toString()
        );

        if (!solAccount) {
            logger.info(`No WSOL token account found. Creating and funding with ` + `${AMOUNT_TO_WSOL} SOL...`);

            // Create WSOL (wrapped SOL) account and fund it with SOL
            await createAndFundWSOL(wsolAta);
        } else {
            logger.info('WSOL account already exists in the wallet.');

            // Fetch the WSOL account balance
            const wsolAccountInfo = await getAccount(solanaConnection, wsolAta);
            const wsolBalance = Number(wsolAccountInfo.amount) / LAMPORTS_PER_SOL;
            logger.info(`Current WSOL balance: ${wsolBalance} WSOL`);

            // If WSOL balance is less than AMOUNT_TO_WSOL, top up the WSOL account
            if (wsolBalance < AMOUNT_TO_WSOL) {
                logger.info(`Insufficient WSOL balance. Funding with additional ` + `${AMOUNT_TO_WSOL} +  SOL...`);
                await createAndFundWSOL(wsolAta);
            }
        }

        // Set the quote token associated address
        quoteTokenAssociatedAddress = wsolAta;
    } else {
        const tokenAccount = tokenAccounts.find(
            (acc) => acc.accountInfo.mint.toString() === quoteToken.mint.toString()
        );

        if (!tokenAccount) {
            throw new Error(`No ${quoteToken.symbol} token account found in wallet: ${wallet.publicKey}`);
        }

        quoteTokenAssociatedAddress = tokenAccount.pubkey;
    }
}

// Helper function to create and fund WSOL account
async function createAndFundWSOL(wsolAta: PublicKey): Promise<void> {
    // Create WSOL (wrapped SOL) account and fund it
    const instructions = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SET_COMPUTE_UNITPRICE }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: SET_COMPUTE_UNIT_LIMIT }),
        createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            wsolAta,
            wallet.publicKey,
            Token.WSOL.mint
        ),
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: wsolAta,
            lamports: AMOUNT_TO_WSOL * LAMPORTS_PER_SOL,
        }),
        createSyncNativeInstruction(wsolAta), // Sync native to wrap SOL into WSOL
    ];

    // Prepare message and versioned transaction
    const latestBlockhash = await solanaConnection.getLatestBlockhash();
    logger.info('Fetched latest blockhash for transaction.');

    const message = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: instructions,
    }).compileToV0Message();

    const versionedTransaction = new VersionedTransaction(message);

    // Sign the transaction
    versionedTransaction.sign([wallet]);

    // Send the serialized transaction using sendRawTransaction
    const signature = await solanaConnection.sendRawTransaction(versionedTransaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: COMMITMENT_LEVEL,
    });

    // Confirm transaction with the new `TransactionConfirmationStrategy`
    const confirmationStrategy = {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    };

    await solanaConnection.confirmTransaction(confirmationStrategy, COMMITMENT_LEVEL);
    logger.info(`Created and funded WSOL account with ` + AMOUNT_TO_WSOL + ` SOL. Transaction signature: ${signature}`);
}

//buy function
export async function buy(
    tokenMint: PublicKey,
    poolKey: LiquidityPoolKeysV4,
    solAmount: number
) {
    logger.info('get latestBlockhash ata');
    const latestBlockhash = await solanaConnection.getLatestBlockhash();
    logger.info('finish latestBlockhash ata');

    try {
        let solInputAmount: number;

        logger.info('get Token ata');
        const tokenAta = getAssociatedTokenAddressSync(tokenMint, keypair.publicKey);
        console.log("tokenAta===========>", tokenAta);
        logger.info('finish Token ata');

        logger.info('start building buy transaction');

        // if (solAmount > BUY_LIMIT) {
        //     solInputAmount = BUY_LIMIT;
        // } else {
        //     solInputAmount = solAmount;
        // }
        solInputAmount = BUY_LIMIT;
        const amountInLamports = BigInt(Math.floor(solInputAmount! * LAMPORTS_PER_SOL));

        const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
            {
                poolKeys: poolKey,
                userKeys: {
                    tokenAccountIn: quoteTokenAssociatedAddress,
                    tokenAccountOut: tokenAta,
                    owner: keypair.publicKey,
                },
                amountIn: amountInLamports,
                minAmountOut: 0,
            },
            poolKey.version,
        );

        // versioned transaction
        const messageV0 = new TransactionMessage({
            payerKey: keypair.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SET_COMPUTE_UNITPRICE }),
                ComputeBudgetProgram.setComputeUnitLimit({ units: SET_COMPUTE_UNIT_LIMIT }),
                createAssociatedTokenAccountIdempotentInstruction(
                    keypair.publicKey,
                    tokenAta,
                    keypair.publicKey,
                    tokenMint,
                ),
                ...innerTransaction.instructions,
            ],
        }).compileToV0Message();

        const versionedTx = new VersionedTransaction(messageV0);
        versionedTx.sign([keypair]);

        console.log(await solanaConnection.simulateTransaction(versionedTx, { sigVerify: true }))
        logger.info('Finish building transaction');
        logger.info('Start send and confirm transaction');

        await executeJitoTx([versionedTx], keypair, 'processed', latestBlockhash);

    } catch (error) {
        logger.error(error);
        return null;
    }
}


//sell function
export const sell = async (
    rawAccount: MinimalTokenAccountData,
    poolKeys: LiquidityPoolKeysV4,
    tokenAmount: number,
): Promise<void> => {

    try {
        let messageV0: any;
        logger.info('get latestBlockhash ata');
        const latestBlockhash = await solanaConnection.getLatestBlockhash();
        logger.info('finish latestBlockhash ata');

        logger.info('start building buy transaction');

        let ata: PublicKey;

        ata = rawAccount.address;

        const tokenAccountInfo = await getAccount(solanaConnection, ata);

        const realTokenBalance = Math.floor(Number(tokenAccountInfo.amount) * (SELL_PERCENT / 100));


        // Fetch the token balance after ensuring the account exists
        const tokenBalance = realTokenBalance.toString();
        logger.info(`Token balance for ${rawAccount.mint.toString()} is: ${tokenBalance}`);

        if (tokenBalance === '0') {
            logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
            return;
        }


        const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
            {
                poolKeys: poolKeys!,
                userKeys: {
                    tokenAccountOut: quoteTokenAssociatedAddress,
                    tokenAccountIn: ata,
                    owner: wallet.publicKey,
                },
                amountIn: tokenBalance,
                minAmountOut: 0,
            },
            poolKeys!.version,
        );

        if (SELL_PERCENT == 100) {

            messageV0 = new TransactionMessage({
                payerKey: wallet.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SET_COMPUTE_UNITPRICE }),
                    ComputeBudgetProgram.setComputeUnitLimit({ units: SET_COMPUTE_UNIT_LIMIT }),
                    ...innerTransaction.instructions,
                    createCloseAccountInstruction(ata, wallet.publicKey, wallet.publicKey),
                ],
            }).compileToV0Message();
        } else {
            messageV0 = new TransactionMessage({
                payerKey: wallet.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SET_COMPUTE_UNITPRICE }),
                    ComputeBudgetProgram.setComputeUnitLimit({ units: SET_COMPUTE_UNIT_LIMIT }),
                    ...innerTransaction.instructions,
                    // createCloseAccountInstruction(ata, wallet.publicKey, wallet.publicKey),
                ],
            }).compileToV0Message();
        }
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([wallet, ...innerTransaction.signers]);

        console.log(await solanaConnection.simulateTransaction(transaction, { sigVerify: true }))

        logger.info('Finish building sell transaction');
        logger.info('Start send and confirm sell transaction');

        await executeJitoTx([transaction], keypair, 'processed', latestBlockhash);


    } catch (error) {
        console.log(error)
    }
}




export async function sellWithJupiter(tokenMint: PublicKey) {
    try {
        console.log("🚀 Initiating Sell Transaction via Jupiter...");

        console.log("tokenMint============>", tokenMint)
        // Ensure wallet is connected
        if (!wallet?.publicKey) {
            throw new Error("❌ Wallet not connected or undefined.");
        }

        // Fetch associated token account
        const tokenAccount = await getAssociatedTokenAddress(tokenMint, wallet.publicKey);
        console.log("tokenAccount===========>", tokenAccount);
        // Fetch token balance (as a string)
        const tokenBalanceStr = (await solanaConnection.getTokenAccountBalance(tokenAccount)).value.amount;
        console.log("tokenBalanceStr===========>", tokenBalanceStr);

        // Convert balance to number safely
        const tokenBalance = Number(tokenBalanceStr);
        if (!tokenBalance || tokenBalance <= 0) {
            console.warn("⚠️ No tokens available to sell.");
            return;
        }

        console.log(`📊 Selling ${tokenBalance} tokens...`);

        // Get swap transaction from Jupiter
        const tokenSellTx = await getSellTxWithJupiter(wallet, tokenMint, tokenBalance);
        if (!tokenSellTx) {
            console.error("❌ Failed to get swap transaction from Jupiter.");
            return;
        }

        // Execute transaction with Jito
        const txSig = await executeJitoTx1([tokenSellTx], wallet, "confirmed");
        console.log(`✅ Successfully swapped tokens. Transaction Signature: ${txSig}`);
        // await closeAllTokenAccounts()

    } catch (error) {
        console.error("🔥 Error in sellWithJupiter:", error);
    }
}
