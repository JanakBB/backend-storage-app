import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = process.env.KEY_PAIR_ID;
const cloudfrontDistributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN;

export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  try {
    // Validate required environment variables
    if (!privateKey || !keyPairId || !cloudfrontDistributionDomain) {
      throw new Error("Missing required CloudFront environment variables");
    }

    const cleanDomain = cloudfrontDistributionDomain
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const url = `https://${cleanDomain}/${key}`;

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

    return `${signedUrl}&response-content-disposition=${encodeURIComponent(contentDisposition)}`;
  } catch (error) {
    console.error("CloudFront URL generation error:", error);
    throw new Error("Failed to generate file URL");
  }
};
