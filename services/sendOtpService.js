import { Resend } from "resend";
import OTP from "../models/otpModel.js";

const resend = new Resend(process.env.RESEND_API_KEY);

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
      { upsert: true, new: true } // up = update, sert = insert, new: true = returns updated value.
    );
    console.log(`Stored OTP for ${email}`);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.4;">
        <h2 style="color: #333; font-size: 20px;">Welcome to Storage App</h2>
        <p>Your verification code is: <strong style="font-size: 24px; color: #007bff; letter-spacing: 2px;">${otp}</strong></p>
        <p>This code expires in 10 minutes. If you didn't request it, no worries—just ignore this.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <small style="color: #666;">&copy; 2025 Storage App. All rights reserved.</small>
      </div>
    `;

    const sendResult = await resend.emails.send({
      from: "Storage App <onboarding@resend.dev>", // ← THIS BYPASSES DOMAIN BLOCK
      to: email,
      subject: "Your Storage App Verification Code",
      html,
      text: `Your verification code is: ${otp}\nThis code expires in 10 minutes.`,
    });

    // Check for hidden errors (Resend's sneaky way)
    if (sendResult.error && sendResult.error.length > 0) {
      console.error("Resend Errors:", sendResult.error);
      return {
        success: false,
        message: `Send failed: ${sendResult.error[0].message}`,
      };
    }

    console.log(
      `Resend Success for ${email}: ID=${sendResult.id}, Status=${sendResult.status || "unknown"}`
    );

    console.log(`=== DEV OTP FOR ${email}: ${otp} (expires in 10 min) ===`);

    return {
      success: true,
      message: `Code sent to ${email}! (Resend ID: ${sendResult.id}) Check spam if not in inbox.`,
    };
  } catch (error) {
    console.error("Full Send Error:", error);
    if (error.message.includes("API key") || error.statusCode === 401) {
      return {
        success: false,
        message: "Invalid API key. Regenerate in dashboard and update .env.",
      };
    }
    if (
      error.message.includes("authorized") ||
      error.message.includes("domain")
    ) {
      return {
        success: false,
        message:
          "From domain not authorized. Use onboarding@resend.dev for tests.",
      };
    }
    return { success: false, message: "Failed to send OTP. Check logs." };
  }
}
