import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

// CloudFront configuration - FIXED VARIABLE NAMES
const keyPairId = process.env.KEY_PAIR_ID; // Changed from CLOUDFRONT_KEY_PAIR_ID
const distributionDomain = (
  process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "d22k4cxru6qx1y.cloudfront.net"
)
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

// Read private key from .env
let privateKey;
if (process.env.CLOUDFRONT_PRIVATE_KEY) {
  // Remove quotes and fix newlines
  privateKey = process.env.CLOUDFRONT_PRIVATE_KEY.replace(/^'|'$/g, "") // Remove single quotes
    .replace(/\\n/g, "\n"); // Convert \n to actual newlines
}

// Debug logging
console.log("🔍 CloudFront Config Check:");
console.log("KEY_PAIR_ID:", keyPairId ? "✅ Loaded" : "❌ Missing");
console.log(
  "CLOUDFRONT_DISTRIBUTION_DOMAIN:",
  distributionDomain ? "✅ Loaded" : "❌ Missing"
);
console.log(
  "CLOUDFRONT_PRIVATE_KEY:",
  privateKey ? `✅ Loaded (${privateKey.length} chars)` : "❌ Missing"
);

if (!privateKey || !keyPairId) {
  console.error("❌ CloudFront environment variables missing or invalid");
  console.error("KEY_PAIR_ID:", keyPairId);
  console.error("PRIVATE_KEY_LENGTH:", privateKey?.length);
}

/**
 * Generates a CloudFront signed URL for GET requests.
 * Supports inline preview and forced download.
 */
export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  if (!key) throw new Error("Missing 'key' for CloudFront signed URL");
  if (!filename)
    throw new Error("Missing 'filename' for CloudFront signed URL");
  if (!privateKey || !keyPairId) {
    throw new Error("CloudFront keys not configured properly");
  }

  const safeFilename = filename.replace(/\s+/g, "_").replace(/"/g, "");
  const url = `https://${distributionDomain}/${key}`;
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours
  const responseDisposition = `${download ? "attachment" : "inline"}; filename="${safeFilename}"`;

  try {
    console.log(
      `🔗 Generating ${download ? "DOWNLOAD" : "PREVIEW"} URL for: ${filename}`
    );

    const signedUrl = getSignedUrl({
      url: `${url}?response-content-disposition=${encodeURIComponent(responseDisposition)}`,
      keyPairId,
      privateKey,
      dateLessThan: expiresAt,
    });

    console.log("✅ CloudFront signed URL generated successfully");
    return signedUrl;
  } catch (err) {
    console.error("❌ CloudFront signed URL error:", err.message);
    console.error("Error details:", err);
    throw new Error("Failed to generate CloudFront signed URL");
  }
};
