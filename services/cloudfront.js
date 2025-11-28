import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = process.env.KEY_PAIR_ID;
const dateLessThan = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

const cloudfrontDistributionDomain =
  process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "d22k4cxru6qx1y.cloudfront.net";

export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  const cleanDomain = cloudfrontDistributionDomain
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return `https://${cleanDomain}/${key}?response-content-disposition=${encodeURIComponent(`${download ? "attachment" : "inline"};filename=${filename}`)}`;
};
