const AvalancheManager = require('./avalanche-manager');
require('dotenv').config();

async function check() {
    const avalancheManager = new AvalancheManager(
        process.env.AVALANCHE_RPC_URL || 'http://127.0.0.1:8545',
        process.env.VAULT_REGISTRY_ADDRESS,
        process.env.RELAYER_PRIVATE_KEY
    );

    const address = '0x821824db192d42514aacfdfd24e68b885a4391f3';

    console.log(`Checking vaults for address: ${address}`);

    const userVaults = await avalancheManager.getUserVaults(address);
    const beneficiaryVaults = await avalancheManager.getBeneficiaryVaults(address);
    const lawyerVaults = await avalancheManager.getLawyerVaults(address);

    console.log('User (Owner) Vaults:', userVaults);
    console.log('Beneficiary Vaults:', beneficiaryVaults);
    console.log('Lawyer Vaults:', lawyerVaults);

    const allVaults = [...new Set([...userVaults, ...beneficiaryVaults, ...lawyerVaults])];

    for (const vaultId of allVaults) {
        const vault = await avalancheManager.getVault(vaultId);
        console.log(`\nVault Detail for ${vaultId}:`);
        console.log(JSON.stringify(vault, null, 2));
    }
}

check().catch(err => {
    console.error('Error checking vaults:', err);
    process.exit(1);
});
