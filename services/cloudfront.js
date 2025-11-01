import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = process.env.KEY_PAIR_ID;
const dateLessThan = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
const cloudfrontDistributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN;

export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  const url = `${cloudfrontDistributionDomain}/${key}?response-content-disposition=${encodeURIComponent(`${download ? "attachment" : "inline"};filename=${filename}`)}`;

  const signedUrl = getSignedUrl({
    url,
    keyPairId,
    dateLessThan,
    privateKey,
  });

  return signedUrl;
};
