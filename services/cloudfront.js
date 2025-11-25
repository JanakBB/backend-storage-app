import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = process.env.KEY_PAIR_ID;
const dateLessThan = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

// Use fallback to ensure it always works - no error throwing
const cloudfrontDistributionDomain =
  process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "d22k4cxru6qx1y.cloudfront.net";

export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  try {
    // Simple cleanup without error throwing
    const cleanDomain = cloudfrontDistributionDomain
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const url = `https://${cleanDomain}/${key}?response-content-disposition=${encodeURIComponent(`${download ? "attachment" : "inline"};filename=${filename}`)}`;

    console.log("Generating CloudFront URL for domain:", cleanDomain);

    const signedUrl = getSignedUrl({
      url,
      keyPairId,
      dateLessThan,
      privateKey,
    });

    return signedUrl;
  } catch (error) {
    console.error("CloudFront URL generation error:", error.message);
    // Return a fallback or re-throw based on your needs
    throw new Error(`Failed to generate CloudFront URL: ${error.message}`);
  }
};
