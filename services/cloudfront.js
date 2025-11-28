import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import fs from "fs";

// CloudFront configuration
const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
const distributionDomain = (
  process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "d22k4cxru6qx1y.cloudfront.net"
)
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

// Read private key from .env or file
let privateKey;
if (process.env.CLOUDFRONT_PRIVATE_KEY_PATH) {
  privateKey = fs.readFileSync(process.env.CLOUDFRONT_PRIVATE_KEY_PATH, "utf8");
} else if (process.env.CLOUDFRONT_PRIVATE_KEY) {
  privateKey = process.env.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, "\n");
}

if (!privateKey || !keyPairId) {
  console.warn(
    "⚠️ CloudFront environment variables missing or invalid: CLOUDFRONT_PRIVATE_KEY or CLOUDFRONT_KEY_PAIR_ID"
  );
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
  if (!privateKey || !keyPairId)
    throw new Error("CloudFront keys not configured properly");

  // Replace spaces with underscores and remove problematic characters
  const safeFilename = filename.replace(/\s+/g, "_").replace(/"/g, "");

  const url = `https://${distributionDomain}/${key}`;
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours
  const responseDisposition = `${download ? "attachment" : "inline"}; filename=${safeFilename}`;

  try {
    const signedUrl = getSignedUrl({
      url: `${url}?response-content-disposition=${responseDisposition}`,
      keyPairId,
      privateKey,
      dateLessThan: expiresAt.toISOString(),
    });
    return signedUrl;
  } catch (err) {
    console.error("CloudFront signed URL error:", err.message);
    throw new Error("Failed to generate CloudFront signed URL");
  }
};
