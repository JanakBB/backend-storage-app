import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = process.env.KEY_PAIR_ID;
const dateLessThan = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
const cloudfrontDistributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN;

// Debug the domain
console.log("CloudFront Domain:", cloudfrontDistributionDomain);

// Robust domain cleaning function
const getCleanDomain = (domain) => {
  if (!domain) {
    throw new Error("CLOUDFRONT_DISTRIBUTION_DOMAIN is not set");
  }

  // Remove protocol and any trailing slashes
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // Validate the domain format
  if (!clean.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
    throw new Error(`Invalid CloudFront domain format: ${clean}`);
  }

  return clean;
};

export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  try {
    const cleanDomain = getCleanDomain(cloudfrontDistributionDomain);
    const url = `https://${cleanDomain}/${key}?response-content-disposition=${encodeURIComponent(`${download ? "attachment" : "inline"};filename=${filename}`)}`;

    console.log("Generating signed URL for:", url);

    const signedUrl = getSignedUrl({
      url,
      keyPairId,
      dateLessThan,
      privateKey,
    });

    return signedUrl;
  } catch (error) {
    console.error("CloudFront URL generation error:", error);
    throw error;
  }
};
