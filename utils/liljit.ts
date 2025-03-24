import { LILJITO_RPC_ENDPOINT, RPC_ENDPOINT } from "../constants";
import { Commitment, Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import base58 from 'bs58'
import axios from "axios";
import { logger } from "./logger";

export const sendBundle = async (txs: VersionedTransaction[], payer: Keypair, commitment: Commitment, latestBlockhash: any) => {

    console.log(txs);
    logger.info('start sendBundle');
    try {
        const serializedTxs = txs.map(tx => base58.encode(tx.serialize()))
        const config = {
            headers: {
                "Content-Type": "application/json",
            },
        };
        const data = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [serializedTxs],
        };
        logger.info('start axios');
        axios
            .post(
                LILJITO_RPC_ENDPOINT,
                data,
                config
            )
            .then(function (response: any) {
                // handle success
                console.log("Bundle Id : ", response.data.result)
                return response.data.result as string
            })
            .catch((err) => {
                // handle error
                console.log("Error when sending the bundle");
            });


        const liljitoTxsignature = base58.encode(txs[0].signatures[0]);
        // make same tx confirm part here

        console.log("liljitoTxsignature==============>", liljitoTxsignature)
        console.log("latestBlockhash.lastValidBlockHeight=======>", latestBlockhash.lastValidBlockHeight)
        console.log("latestBlockhash.blockhash,=======>", latestBlockhash.blockhash,)

        // const confirmation = await solanaConnection.confirmTransaction(
        //   {
        //     signature: liljitoTxsignature,
        //     lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        //     blockhash: latestBlockhash.blockhash,
        //   },
        //   commitment,
        // );
        // console.log("🚀 ~ executeLilJitoTx ~ confirmation:", confirmation)

        // if (confirmation.value.err) {
        //   console.log("Confirmtaion error")
        //   return null
        // } else {
        //   console.log("liljitoTxsignature==============>", liljitoTxsignature)
        //   return liljitoTxsignature;
        // }

    } catch (error) {
        console.log('Error during transaction execution', error);
        return null
    }
}
