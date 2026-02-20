require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
    console.log("Checking relayer wallet balance...");
    const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC_URL);
    const wallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
    
    console.log("Wallet address:", wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log("Balance on Fuji:", ethers.formatEther(balance), "AVAX");
}
main().catch(console.error);
