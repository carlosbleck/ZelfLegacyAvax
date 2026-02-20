/**
 * Utility script to derive a Private Key and Address from a Mnemonic.
 * Usage: node derive-key.js "your twelve word mnemonic phrase here"
 */

const { ethers } = require('ethers');

const mnemonic = process.argv.slice(2).join(' ');

if (!mnemonic) {
    console.error('❌ Error: Please provide a mnemonic phrase as an argument.');
    console.log('Usage: node derive-key.js "word1 word2 ... word12"');
    process.exit(1);
}

try {
    // Standard Ethereum derivation path (m/44'/60'/0'/0/0)
    const wallet = ethers.Wallet.fromPhrase(mnemonic.trim());

    console.log('\n✅ Derivation Successful:');
    console.log('--------------------------------------------------');
    console.log(`📍 Address:     ${wallet.address}`);
    console.log(`🔑 Private Key:  ${wallet.privateKey}`);
    console.log('--------------------------------------------------');
    console.log('⚠️  WARNING: Keep your Private Key secret! Never share it.');
} catch (error) {
    console.error('❌ Error: Invalid mnemonic phrase.');
    process.exit(1);
}
