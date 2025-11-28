import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

// Debug: Check what environment variables are available
console.log("CloudFront Config Check:");
console.log("KEY_PAIR_ID exists:", !!process.env.KEY_PAIR_ID);
console.log(
  "CLOUDFRONT_DISTRIBUTION_DOMAIN exists:",
  !!process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN
);
console.log(
  "CLOUDFRONT_PRIVATE_KEY exists:",
  !!process.env.CLOUDFRONT_PRIVATE_KEY
);

const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = process.env.KEY_PAIR_ID;
const cloudfrontDistributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN;

export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  try {
    // Debug the actual values (mask private key for security)
    console.log("KeyPairId:", keyPairId);
    console.log("Distribution Domain:", cloudfrontDistributionDomain);
    console.log("Private Key length:", privateKey?.length);

    // Validate required environment variables with better error messages
    if (!privateKey) {
      throw new Error(
        "CLOUDFRONT_PRIVATE_KEY is missing from environment variables"
      );
    }
    if (!keyPairId) {
      throw new Error("KEY_PAIR_ID is missing from environment variables");
    }
    if (!cloudfrontDistributionDomain) {
      throw new Error(
        "CLOUDFRONT_DISTRIBUTION_DOMAIN is missing from environment variables"
      );
    }

    const cleanDomain = cloudfrontDistributionDomain
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const url = `https://${cleanDomain}/${key}`;

    console.log("Generating URL for:", url);

    // Fix private key formatting - replace escaped newlines with actual newlines
    const formattedPrivateKey = privateKey.replace(/\\n/g, "\n");

    // Create signed URL with 24 hour expiration
    const signedUrl = getSignedUrl({
      url,
      keyPairId,
      privateKey: formattedPrivateKey,
      dateLessThan: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24 hours
    });

    // Append content disposition parameter
    const dispositionType = download ? "attachment" : "inline";
    const contentDisposition = `${dispositionType}; filename="${encodeURIComponent(filename)}"`;

    const finalUrl = `${signedUrl}&response-content-disposition=${encodeURIComponent(contentDisposition)}`;

    console.log("Successfully generated signed URL");
    return finalUrl;
  } catch (error) {
    console.error("CloudFront URL generation error:", error.message);
    throw new Error(`Failed to generate file URL: ${error.message}`);
  }
};
