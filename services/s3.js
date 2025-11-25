import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Create a function to get the S3 client (lazy initialization)
const getS3Client = () => {
  return new S3Client({
    region: process.env.AWS_REGION || "ap-south-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
};

export const createUploadSignedUrl = async ({ key, contentType }) => {
  const s3Client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: "palomacoding",
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: 3600,
    signedHeaders: new Set(["content-type"]),
  });

  return url;
};

export const createGetSignedUrl = async ({
  key,
  download = false,
  filename,
}) => {
  const s3Client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: "palomacoding",
    Key: key,
    ResponseContentDisposition: `${download ? "attachment" : "inline"}; filename=${encodeURIComponent(filename)}`,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: 300,
  });

  return url;
};

export const getS3FileMetaData = async (key) => {
  const s3Client = getS3Client();
  const command = new HeadObjectCommand({
    Bucket: "palomacoding",
    Key: key,
  });
  return await s3Client.send(command);
};

export const deleteS3File = async (key) => {
  const s3Client = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: "palomacoding",
    Key: key,
  });
  return await s3Client.send(command);
};

export const deleteS3Files = async (keys) => {
  const s3Client = getS3Client();
  const command = new DeleteObjectsCommand({
    Bucket: "palomacoding",
    Delete: {
      Objects: keys,
      Quiet: false,
    },
  });
  return await s3Client.send(command);
};
