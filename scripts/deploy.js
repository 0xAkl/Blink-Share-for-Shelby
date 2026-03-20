// scripts/deploy.js
// Run: npx hardhat run scripts/deploy.js --network sepolia

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("──────────────────────────────────────");
  console.log("  Blink Share — Contract Deployer");
  console.log("──────────────────────────────────────");
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("──────────────────────────────────────\n");

  // Deploy BlinkShare
  const Factory = await ethers.getContractFactory("BlinkShare");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`✅  BlinkShare deployed at: ${address}`);

  // Persist address + ABI for frontend/backend
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../artifacts/contracts/BlinkShare.sol/BlinkShare.json"),
      "utf8"
    )
  );

  const deployInfo = {
    address,
    network: hre.network.name,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    abi: artifact.abi,
  };

  const outDir = path.join(__dirname, "../frontend/src/contracts");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "BlinkShare.json"), JSON.stringify(deployInfo, null, 2));
  console.log(`📄  ABI + address saved to frontend/src/contracts/BlinkShare.json`);

  // Also write to backend
  const backendOutDir = path.join(__dirname, "../backend/src");
  fs.mkdirSync(backendOutDir, { recursive: true });
  fs.writeFileSync(path.join(backendOutDir, "contract.json"), JSON.stringify(deployInfo, null, 2));
  console.log(`📄  ABI + address saved to backend/src/contract.json`);

  console.log("\n✅  Deployment complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
