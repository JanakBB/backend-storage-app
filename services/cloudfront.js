import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = "E2JSNJU4ZCRFY3";
const dateLessThan = new Date(Date.now() + 1000 * 60 * 60).toISOString();
const cloudfrontDistributionDomain = "https://d35b7ztnptonac.cloudfront.net";

export const createCloudFrontGetSignedUrl = ({
  key,
  download = false,
  filename,
}) => {
  console.log(key);
  const url = `${cloudfrontDistributionDomain}/${key}?response-content-disposition=${encodeURIComponent(`${download ? "attachment" : "inline"};filename=${filename}`)}`;

  const signedUrl = getSignedUrl({
    url,
    keyPairId,
    dateLessThan,
    privateKey,
  });

  return signedUrl;
};
