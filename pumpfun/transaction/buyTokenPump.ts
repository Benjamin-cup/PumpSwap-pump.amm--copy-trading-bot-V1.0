import { createAssociatedTokenAccountIdempotentInstruction, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import getBondingCurvePDA from "../utils/getBondingCurvePDA";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import getBondingCurveTokenAccountWithRetry from "../utils/getBondingCurveTokenAccountWithRetry";
import { PRIVATE_KEY, SET_COMPUTE_UNIT_LIMIT, SET_COMPUTE_UNITPRICE, GRPC_ENDPOINT, BUY_LIMIT, PUMPFUN_BUY_SLIPPAGE } from "../../constants";
import { PumpFun } from "../idl/pump-fun";
import IDL from "../idl/pump-fun.json";
import tokenDataFromBondingCurveTokenAccBuffer from "../utils/tokenDataFromBondingCurveTokenAccBuffer";
import { BN } from "bn.js";
import getBuyPrice from "../utils/getBuyPrice";
import Client from "@triton-one/yellowstone-grpc";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import dotenv from 'dotenv'
import { executeJitoTx } from "../utils/jito";
import { logger } from "../../utils";
import { executeJitoTx1 } from "../utils/sellJito";
import { sendBundle } from "../../utils/liljit";
dotenv.config()


const TOKEN = process.env.GRPC_TOKEN!;
const client = new Client(GRPC_ENDPOINT, TOKEN, {});


const BOANDING_CURVE_ACC_RETRY_AMOUNT = 50;
const BOANDING_CURVE_ACC_RETRY_DELAY = 50;

const solanaConnection = new Connection(process.env.RPC_ENDPOINT!, 'processed');
const stakeConnection = new Connection(process.env.SEND_RPC_ENDPOINT!, 'processed')


const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY))

// Load Pumpfun provider
const provider = new AnchorProvider(solanaConnection, new Wallet(keypair), {
    commitment: "processed",
});
const program = new Program<PumpFun>(IDL as PumpFun, provider);

const programId = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Create transaction

interface Payload {
    transaction: TransactionMessages;
}

interface TransactionMessages {
    content: string;
}

export async function buyTokenPumpfun(
    mint: PublicKey,
    solAmount: number,
) {
    try {
        let transaction = new Transaction();

        console.log("--------------- Start Buy Token --------------", '\n')
        // Get/Create token account
        logger.info('Start get token ata');
        const associatedUser = await getAssociatedTokenAddress(mint, keypair.publicKey, false);
        logger.info('Finish get token ata');


        transaction.add(createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, associatedUser, keypair.publicKey, mint)
        );


        logger.info('Start get BondingCurve PDA');
        const bondingCurve = getBondingCurvePDA(mint, programId);
        logger.info('Finish get BondingCurve PDA');


        logger.info('Start get associated BondingCurve ');
        const associatedBondingCurve = await getAssociatedTokenAddress(mint, bondingCurve, true);
        logger.info('Finsih get associated BondingCurve ');

        logger.info('Start get bondingCurveTokenAccount ');
        const bondingCurveTokenAccount = await getBondingCurveTokenAccountWithRetry(
            solanaConnection,
            bondingCurve,
            BOANDING_CURVE_ACC_RETRY_AMOUNT,
            BOANDING_CURVE_ACC_RETRY_DELAY
        );

        console.log("bondingCurveTokenAccount=====>", bondingCurveTokenAccount)
        logger.info('Finish get bondingCurveTokenAccount ');

        if (bondingCurveTokenAccount === null) {
            throw new Error("Bonding curve account not found");
        }

        logger.info('Start get tokenData ');
        const tokenData = tokenDataFromBondingCurveTokenAccBuffer(bondingCurveTokenAccount!.data);
        logger.info('Finish get tokenData ');

        if (tokenData.complete) {
            throw new Error("Bonding curve already completed");
        }
        const SLIPAGE_POINTS = BigInt(PUMPFUN_BUY_SLIPPAGE * 100);
        console.log("SLIPAGE_POINTS", SLIPAGE_POINTS)
        const solAmountLamp = BigInt(Math.round(BUY_LIMIT * LAMPORTS_PER_SOL));
        console.log("solAmountLamp", solAmountLamp)

        const buyAmountToken = BigInt(Math.round(Number(getBuyPrice(solAmountLamp, tokenData)) * 0.8));

        // const buyAmountSolWithSlippage = solAmountLamp + (solAmountLamp * SLIPAGE_POINTS) / 10000n;
        // console.log("buyAmountSolWithSlippage", buyAmountSolWithSlippage)
        const solBalance = await solanaConnection.getBalance(keypair.publicKey);
        console.log("My wallet sol Balance");
        const buyAmountSolWithSlippage = BigInt(Math.round((solBalance - 0.005) * LAMPORTS_PER_SOL));

        const FEE_RECEIPT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

        // request a specific compute unit budget
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
            units: SET_COMPUTE_UNITPRICE,
        });

        // set the desired priority fee
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: SET_COMPUTE_UNIT_LIMIT,
        });

        logger.info('Start get latestBlockhash ');
        const latestBlockhash = await client.getLatestBlockhash()
        logger.info('Finish get latestBlockhash ');

        logger.info('Start building buy transaction ');

        transaction
            .add(modifyComputeUnits)
            .add(addPriorityFee)
            .add(
                await program.methods.
                    buy(new BN(buyAmountToken.toString()), new BN(buyAmountSolWithSlippage.toString()))
                    .accounts({
                        associatedBondingCurve: associatedBondingCurve,
                        feeRecipient: FEE_RECEIPT,
                        mint: mint,
                        associatedUser: associatedUser,
                        user: keypair.publicKey
                    }).transaction()

            );

        transaction.feePayer = keypair.publicKey;
        transaction.recentBlockhash = latestBlockhash.blockhash;

        const messageV0 = new TransactionMessage({
            payerKey: keypair.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: transaction.instructions,
        }).compileToV0Message()

        const versionedTx = new VersionedTransaction(messageV0);
        versionedTx.sign([keypair]);
        console.log(await solanaConnection.simulateTransaction(versionedTx, { sigVerify: true }))
        logger.info('Finish building buy transaction ');

        logger.info('Start send and confirm buy transaction ');

        const jitoResult = executeJitoTx([versionedTx], keypair, 'processed', latestBlockhash);
        // const jitoResult = await sendBundle([versionedTx], keypair, 'processed', latestBlockhash);

        logger.info('Finish send and confirm buy transaction ');

        if (jitoResult) {
            return jitoResult
        }


        // const txSig = await executeJitoTx1([versionedTx], keypair, "confirmed");
        // console.log(`✅ Successfully swapped tokens. Transaction Signature: ${txSig}`);
        // if (txSig) {
        //     return txSig
        // }

    } catch (error) {
        console.error(error);
        return false
    }
}
