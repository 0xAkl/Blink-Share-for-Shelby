// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BlinkShare
 * @notice Decentralized temporary file sharing via Shelby hot storage.
 *         Stores metadata on-chain: CID, owner, expiry, access control.
 * @dev    Designed for testnet; gas-optimised via packed structs & mappings.
 */
contract BlinkShare {

    // ─────────────────────────────────────────────────────────────────────────
    //  TYPES
    // ─────────────────────────────────────────────────────────────────────────

    struct FileRecord {
        bytes32  cidHash;         // keccak256 of the Shelby CID string
        address  owner;           // uploader wallet
        uint64   expiresAt;       // unix timestamp
        uint64   uploadedAt;      // unix timestamp
        uint64   fileSizeKb;      // in kilobytes
        uint32   downloadCount;   // counter
        bool     passwordProtected;
        bool     walletGated;     // restrict to allowlist
        bool     oneTimeLink;     // deleted after first download
        bool     revoked;         // owner can revoke early
        bytes32  passwordHash;    // keccak256(salt, password) — 0x0 if none
        string   fileName;        // original filename (for UX only)
        string   mimeType;        // MIME type
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice price per kilobyte in wei (adjustable by admin)
    uint256 public pricePerKb = 0.000001 ether;

    address public admin;

    /// fileId => FileRecord
    mapping(bytes32 => FileRecord) private files;

    /// fileId => allowlisted wallets (for wallet-gated files)
    mapping(bytes32 => mapping(address => bool)) private walletAllowlist;

    /// owner => list of fileIds they uploaded
    mapping(address => bytes32[]) private ownerFiles;

    // ─────────────────────────────────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────────────────────────────────

    event FileUploaded(
        bytes32 indexed fileId,
        address indexed owner,
        string          fileName,
        uint64          expiresAt,
        uint64          fileSizeKb
    );
    event FileAccessed(bytes32 indexed fileId, address indexed accessor);
    event FileRevoked(bytes32 indexed fileId, address indexed owner);
    event FileExpired(bytes32 indexed fileId);
    event PriceUpdated(uint256 newPricePerKb);

    // ─────────────────────────────────────────────────────────────────────────
    //  ERRORS  (cheaper than revert strings)
    // ─────────────────────────────────────────────────────────────────────────

    error NotOwner();
    error FileNotFound();
    error FileExpiredOrRevoked();
    error AccessDenied();
    error InvalidExpiry();
    error InsufficientPayment();
    error ZeroSize();

    // ─────────────────────────────────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        admin = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier fileExists(bytes32 fileId) {
        if (files[fileId].owner == address(0)) revert FileNotFound();
        _;
    }

    modifier notExpiredOrRevoked(bytes32 fileId) {
        FileRecord storage f = files[fileId];
        if (f.revoked || block.timestamp > f.expiresAt) {
            emit FileExpired(fileId);
            revert FileExpiredOrRevoked();
        }
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  WRITE FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a new file upload on-chain.
     * @param cid               Shelby content identifier string
     * @param fileName          Original filename for display
     * @param mimeType          MIME type of file
     * @param fileSizeKb        File size in kilobytes
     * @param expirySeconds     How many seconds from now until expiry
     * @param passwordHash      keccak256(salt ++ password). Pass bytes32(0) if none.
     * @param allowedWallets    List of wallets allowed to access (empty = public)
     * @param oneTimeLink       Delete record after first download
     * @return fileId           Unique identifier for this upload
     */
    function uploadFile(
        string  calldata cid,
        string  calldata fileName,
        string  calldata mimeType,
        uint64           fileSizeKb,
        uint64           expirySeconds,
        bytes32          passwordHash,
        address[] calldata allowedWallets,
        bool             oneTimeLink
    ) external payable returns (bytes32 fileId) {
        // ── validations ──────────────────────────────────────────────────────
        if (fileSizeKb == 0)           revert ZeroSize();
        if (expirySeconds < 60)        revert InvalidExpiry();         // min 1 min
        if (expirySeconds > 30 days)   revert InvalidExpiry();         // max 30 days

        uint256 required = pricePerKb * fileSizeKb;
        if (msg.value < required)      revert InsufficientPayment();

        // ── generate deterministic file ID ───────────────────────────────────
        fileId = keccak256(abi.encodePacked(
            msg.sender,
            cid,
            block.timestamp,
            block.prevrandao
        ));

        // ── write record ──────────────────────────────────────────────────────
        bool walletGated = allowedWallets.length > 0;
        files[fileId] = FileRecord({
            cidHash         : keccak256(bytes(cid)),
            owner           : msg.sender,
            expiresAt       : uint64(block.timestamp) + expirySeconds,
            uploadedAt      : uint64(block.timestamp),
            fileSizeKb      : fileSizeKb,
            downloadCount   : 0,
            passwordProtected: passwordHash != bytes32(0),
            walletGated     : walletGated,
            oneTimeLink     : oneTimeLink,
            revoked         : false,
            passwordHash    : passwordHash,
            fileName        : fileName,
            mimeType        : mimeType
        });

        // ── wallet allowlist ──────────────────────────────────────────────────
        for (uint i = 0; i < allowedWallets.length; ) {
            walletAllowlist[fileId][allowedWallets[i]] = true;
            unchecked { ++i; }
        }

        ownerFiles[msg.sender].push(fileId);

        emit FileUploaded(fileId, msg.sender, fileName, files[fileId].expiresAt, fileSizeKb);
    }

    /**
     * @notice Validate access to a file. Returns the CID hash if access granted.
     * @param fileId        The file ID
     * @param passwordHash  keccak256(salt ++ password) if password-protected; bytes32(0) otherwise
     */
    function validateAccess(
        bytes32 fileId,
        bytes32 passwordHash
    ) external fileExists(fileId) notExpiredOrRevoked(fileId) returns (bool) {
        FileRecord storage f = files[fileId];

        // ── wallet gate check ─────────────────────────────────────────────────
        if (f.walletGated) {
            if (!walletAllowlist[fileId][msg.sender] && msg.sender != f.owner) {
                revert AccessDenied();
            }
        }

        // ── password check ────────────────────────────────────────────────────
        if (f.passwordProtected) {
            if (passwordHash != f.passwordHash) revert AccessDenied();
        }

        // ── increment download count ──────────────────────────────────────────
        unchecked { f.downloadCount++; }

        // ── one-time link: revoke after first access ───────────────────────────
        if (f.oneTimeLink && f.downloadCount >= 1) {
            f.revoked = true;
        }

        emit FileAccessed(fileId, msg.sender);
        return true;
    }

    /**
     * @notice Owner can revoke a file before expiry.
     */
    function revokeFile(bytes32 fileId)
        external
        fileExists(fileId)
    {
        if (files[fileId].owner != msg.sender) revert NotOwner();
        files[fileId].revoked = true;
        emit FileRevoked(fileId, msg.sender);
    }

    /**
     * @notice Add wallets to an existing wallet-gated file.
     */
    function addToAllowlist(bytes32 fileId, address[] calldata wallets)
        external
        fileExists(fileId)
    {
        if (files[fileId].owner != msg.sender) revert NotOwner();
        for (uint i = 0; i < wallets.length; ) {
            walletAllowlist[fileId][wallets[i]] = true;
            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  READ FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Get public metadata for a file (no access check).
     */
    function getFileMeta(bytes32 fileId)
        external
        view
        fileExists(fileId)
        returns (
            address  owner,
            string   memory fileName,
            string   memory mimeType,
            uint64   expiresAt,
            uint64   uploadedAt,
            uint64   fileSizeKb,
            uint32   downloadCount,
            bool     passwordProtected,
            bool     walletGated,
            bool     oneTimeLink,
            bool     revoked,
            bool     isExpired
        )
    {
        FileRecord storage f = files[fileId];
        return (
            f.owner,
            f.fileName,
            f.mimeType,
            f.expiresAt,
            f.uploadedAt,
            f.fileSizeKb,
            f.downloadCount,
            f.passwordProtected,
            f.walletGated,
            f.oneTimeLink,
            f.revoked,
            block.timestamp > f.expiresAt
        );
    }

    /**
     * @notice Check if a wallet is on a file's allowlist.
     */
    function isAllowlisted(bytes32 fileId, address wallet)
        external
        view
        returns (bool)
    {
        return walletAllowlist[fileId][wallet];
    }

    /**
     * @notice Get all file IDs uploaded by an address.
     */
    function getOwnerFiles(address owner)
        external
        view
        returns (bytes32[] memory)
    {
        return ownerFiles[owner];
    }

    /**
     * @notice Compute the upload cost for a given size.
     */
    function getUploadCost(uint64 fileSizeKb)
        external
        view
        returns (uint256)
    {
        return pricePerKb * fileSizeKb;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  ADMIN
    // ─────────────────────────────────────────────────────────────────────────

    function updatePrice(uint256 newPricePerKb) external onlyAdmin {
        pricePerKb = newPricePerKb;
        emit PriceUpdated(newPricePerKb);
    }

    function withdraw() external onlyAdmin {
        (bool ok, ) = admin.call{value: address(this).balance}("");
        require(ok, "Transfer failed");
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0));
        admin = newAdmin;
    }
}
