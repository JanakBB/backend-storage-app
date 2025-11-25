import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
config();

console.log("Testing AWS credentials...");
console.log("AWS_ACCESS_KEY_ID:", process.env.AWS_ACCESS_KEY_ID ? "✅ Set" : "❌ Missing");
console.log("AWS_SECRET_ACCESS_KEY:", process.env.AWS_SECRET_ACCESS_KEY ? "✅ Set" : "❌ Missing");
console.log("AWS_REGION:", process.env.AWS_REGION || "❌ Missing");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function testAWS() {
  try {
    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);
    console.log("✅ AWS credentials are valid!");
    console.log("Available buckets:", response.Buckets?.map(b => b.Name));
  } catch (error) {
    console.log("❌ AWS credentials error:", error.message);
    console.log("This usually means:");
    console.log("1. The Access Key ID is incorrect");
    console.log("2. The Secret Access Key is incorrect"); 
    console.log("3. The IAM user doesn't have S3 permissions");
    console.log("4. The credentials are deactivated");
  }
}

testAWS();
