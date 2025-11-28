import { Resend } from "resend";
import OTP from "../models/otpModel.js";

// Lazy initialization for Resend
let resendInstance = null;

const getResend = () => {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set in environment variables");
    }
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
};

export async function sendOtpService(email) {
  try {
    if (!email || !email.includes("@")) {
      return { success: false, message: "Valid email required." };
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.findOneAndUpdate(
      { email },
      { otp, createdAt: new Date(), expiresAt },
      { upsert: true, new: true }
    );

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.4;">
        <h2 style="color: #333; font-size: 20px;">Welcome to Storage App</h2>
        <p>Your verification code is: <strong style="font-size: 24px; color: #007bff; letter-spacing: 2px;">${otp}</strong></p>
        <p>This code expires in 10 minutes. If you didn't request it, no worries—just ignore this.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <small style="color: #666;">&copy; 2025 Storage App. All rights reserved.</small>
        <br>
        <small style="color: #999;">Sent from <a href="https://www.palomacoding.xyz">palomacoding.xyz</a></small>
      </div>
    `;

    // Initialize Resend only when needed
    const resend = getResend();
    const sendResult = await resend.emails.send({
      from: "Storage App <noreply@palomacoding.xyz>",
      to: email,
      subject: "Your Storage App Verification Code",
      html,
      text: `Your verification code is: ${otp}\nThis code expires in 10 minutes.`,
    });

    // Check for hidden errors
    if (sendResult.error && sendResult.error.length > 0) {
      console.error("Resend Errors:", sendResult.error);
      return {
        success: false,
        message: `Send failed: ${sendResult.error[0].message}`,
      };
    }

    return {
      success: true,
      message: `Verification code sent to ${email}!`,
      otpId: sendResult.id,
    };
  } catch (error) {
    console.error("Full Send Error:", error);

    // Specific error handling
    if (error.message.includes("API key") || error.statusCode === 401) {
      return {
        success: false,
        message: "Email service configuration error. Please try again later.",
      };
    }
    if (
      error.message.includes("authorized") ||
      error.message.includes("domain") ||
      error.message.includes("not verified")
    ) {
      return {
        success: false,
        message:
          "Email service temporarily unavailable. Please try again later.",
      };
    }

    // Generic error
    return {
      success: false,
      message: "Failed to send verification code. Please try again.",
    };
  }
}

export async function verifyOtpService(email, otp) {
  try {
    if (!email || !otp) {
      return { success: false, message: "Email and OTP are required." };
    }

    const otpRecord = await OTP.findOne({
      email,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      return { success: false, message: "OTP not found or expired." };
    }

    if (otpRecord.otp !== otp) {
      return { success: false, message: "Invalid OTP code." };
    }

    // Delete the OTP after successful verification
    await OTP.deleteOne({ email });

    return {
      success: true,
      message: "OTP verified successfully.",
    };
  } catch (error) {
    console.error("OTP Verification Error:", error);
    return {
      success: false,
      message: "Failed to verify OTP. Please try again.",
    };
  }
}

export async function resendOtpService(email) {
  try {
    if (!email || !email.includes("@")) {
      return { success: false, message: "Valid email required." };
    }

    // Delete any existing OTP for this email
    await OTP.deleteOne({ email });

    // Send new OTP
    return await sendOtpService(email);
  } catch (error) {
    console.error("Resend OTP Error:", error);
    return {
      success: false,
      message: "Failed to resend OTP. Please try again.",
    };
  }
}
