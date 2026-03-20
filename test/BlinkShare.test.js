// test/BlinkShare.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BlinkShare", function () {
  let contract, owner, alice, bob;
  const ONE_HOUR = 3600;
  const ONE_KB   = 1n;
  let pricePerKb;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BlinkShare");
    contract = await Factory.deploy();
    pricePerKb = await contract.pricePerKb();
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  const upload = (signer, overrides = {}) => {
    const cid      = overrides.cid       ?? "shelby://QmTestCID123";
    const name     = overrides.fileName  ?? "test.pdf";
    const mime     = overrides.mimeType  ?? "application/pdf";
    const size     = overrides.sizeKb    ?? 1n;
    const expiry   = overrides.expiry    ?? ONE_HOUR;
    const pwHash   = overrides.pwHash    ?? ethers.ZeroHash;
    const wallets  = overrides.wallets   ?? [];
    const oneTime  = overrides.oneTime   ?? false;
    const value    = overrides.value     ?? pricePerKb * size;

    return contract.connect(signer).uploadFile(
      cid, name, mime, size, expiry, pwHash, wallets, oneTime,
      { value }
    );
  };

  // ── upload ─────────────────────────────────────────────────────────────────
  describe("uploadFile()", () => {
    it("registers a file and emits FileUploaded", async () => {
      await expect(upload(alice)).to.emit(contract, "FileUploaded");
    });

    it("reverts with InsufficientPayment when underpaying", async () => {
      await expect(upload(alice, { value: 0n }))
        .to.be.revertedWithCustomError(contract, "InsufficientPayment");
    });

    it("reverts with InvalidExpiry when expiry < 60s", async () => {
      await expect(upload(alice, { expiry: 30 }))
        .to.be.revertedWithCustomError(contract, "InvalidExpiry");
    });

    it("reverts with InvalidExpiry when expiry > 30 days", async () => {
      const tooBig = 31 * 24 * 3600;
      await expect(upload(alice, { expiry: tooBig }))
        .to.be.revertedWithCustomError(contract, "InvalidExpiry");
    });

    it("reverts with ZeroSize when fileSizeKb is 0", async () => {
      await expect(upload(alice, { sizeKb: 0n, value: 0n }))
        .to.be.revertedWithCustomError(contract, "ZeroSize");
    });
  });

  // ── access ─────────────────────────────────────────────────────────────────
  describe("validateAccess()", () => {
    let fileId;

    beforeEach(async () => {
      const tx = await upload(alice);
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "FileUploaded");
      fileId = event.args.fileId;
    });

    it("grants access to a public file", async () => {
      await expect(contract.connect(bob).validateAccess(fileId, ethers.ZeroHash))
        .to.emit(contract, "FileAccessed");
    });

    it("increments downloadCount on each access", async () => {
      await contract.connect(bob).validateAccess(fileId, ethers.ZeroHash);
      const meta = await contract.getFileMeta(fileId);
      expect(meta.downloadCount).to.equal(1);
    });
  });

  // ── password ───────────────────────────────────────────────────────────────
  describe("Password protection", () => {
    let fileId;
    const password = "s3cr3t";
    const salt     = ethers.encodeBytes32String("shelby-salt");
    const pwHash   = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32","string"], [salt, password])
    );

    beforeEach(async () => {
      const tx = await upload(alice, { pwHash });
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "FileUploaded");
      fileId = event.args.fileId;
    });

    it("grants access with correct password hash", async () => {
      await expect(contract.connect(bob).validateAccess(fileId, pwHash))
        .to.emit(contract, "FileAccessed");
    });

    it("denies access with wrong password hash", async () => {
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
      await expect(contract.connect(bob).validateAccess(fileId, wrongHash))
        .to.be.revertedWithCustomError(contract, "AccessDenied");
    });
  });

  // ── revocation ─────────────────────────────────────────────────────────────
  describe("revokeFile()", () => {
    let fileId;
    beforeEach(async () => {
      const tx = await upload(alice);
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "FileUploaded");
      fileId = event.args.fileId;
    });

    it("allows owner to revoke", async () => {
      await expect(contract.connect(alice).revokeFile(fileId))
        .to.emit(contract, "FileRevoked");
    });

    it("blocks access after revocation", async () => {
      await contract.connect(alice).revokeFile(fileId);
      await expect(contract.connect(bob).validateAccess(fileId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(contract, "FileExpiredOrRevoked");
    });

    it("prevents non-owner from revoking", async () => {
      await expect(contract.connect(bob).revokeFile(fileId))
        .to.be.revertedWithCustomError(contract, "NotOwner");
    });
  });

  // ── one-time link ──────────────────────────────────────────────────────────
  describe("One-time links", () => {
    let fileId;
    beforeEach(async () => {
      const tx = await upload(alice, { oneTime: true });
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "FileUploaded");
      fileId = event.args.fileId;
    });

    it("allows first download", async () => {
      await expect(contract.connect(bob).validateAccess(fileId, ethers.ZeroHash))
        .to.emit(contract, "FileAccessed");
    });

    it("blocks second download", async () => {
      await contract.connect(bob).validateAccess(fileId, ethers.ZeroHash);
      await expect(contract.connect(bob).validateAccess(fileId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(contract, "FileExpiredOrRevoked");
    });
  });

  // ── admin ──────────────────────────────────────────────────────────────────
  describe("Admin", () => {
    it("allows admin to update price", async () => {
      await contract.connect(owner).updatePrice(ethers.parseEther("0.000002"));
      expect(await contract.pricePerKb()).to.equal(ethers.parseEther("0.000002"));
    });

    it("allows admin to withdraw collected fees", async () => {
      await upload(alice, { value: pricePerKb * 100n, sizeKb: 100n });
      const balBefore = await ethers.provider.getBalance(owner.address);
      await contract.connect(owner).withdraw();
      const balAfter = await ethers.provider.getBalance(owner.address);
      expect(balAfter).to.be.gt(balBefore);
    });
  });
});
