const hre = require("hardhat");
console.log("Upgrades plugin present:", !!hre.upgrades);
if (hre.upgrades) {
    console.log("Upgrades functions:", Object.keys(hre.upgrades));
}
process.exit(0);
