import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  uploadImageWithThumbnail,
  deleteFromS3,
  getPublicUrl,
  generateS3Key,
  uploadToS3,
  uploadToS3Direct
} from '../../utils/s3.js';

import crypto from 'crypto';
//import bcrypt from 'bcrypt';
import Sib from 'sib-api-v3-sdk';

import { Prisma } from '../../config/db.js';

// Helper function to parse boolean values
const parseToNumber = (value) => {
  if (value === undefined || value === null) return undefined;
  return value === '1' || value === 1 || value === true ? 1 : 0;
};

const sendResetEmail = async (toEmail, toName, resetLink) => {
  try {
    const client = Sib.ApiClient.instance;
    const apiKey = client.authentications['api-key'];
    apiKey.apiKey = process.env.SENDINBLUE_API_KEY;
    const tranEmailApi = new Sib.TransactionalEmailsApi();

    const payload = { 
      
      sender: { name: 'Outlook Image Library', email: 'noreply@outlookindia.co.in' },
      to: [{ email: toEmail, name: toName }],
      bcc: [{ email: 'nareshsinha3@gmail.com', name: 'Naresh Sinha' }, { email: 'swastik.tripathi@enpointe.io', name: 'Swastik Tripathi' }],
      subject: 'Reset your Outlook Image Library password',
      htmlContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5;">
     <tr>
      <td align="center" style="padding: 20px 0;">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
           <tr>
            <td style="padding: 32px 32px 0 32px;">
              <div style="border-bottom: 3px solid #df0f19; padding-bottom: 16px;"><h2 style="color: #111827; margin: 0; font-size: 24px;">Reset your password</h2></div>
             </td>
           </tr> 
           <tr>
            <td style="padding: 24px 32px;">
              <p style="color: #4b5563; margin: 0 0 24px 0; line-height: 1.6; font-size: 15px;">
                Hi ${toName},<br><br>
                We received a request to reset the password for your Outlook Image Library account.
                Click the button below to choose a new password. This link expires in <strong style="color: #df0f19;">1 hour</strong>.
              </p> 
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                 <tr>
                  <td align="center" style="padding: 32px 0;">
                    <a href="${resetLink}" style="display: inline-block; background: #df0f19; color: #ffffff;  text-decoration: none; padding: 12px 32px; border-radius: 6px;  font-weight: 600; font-size: 15px; box-shadow: 0 2px 4px rgba(223,15,25,0.2);">
                      Reset Password </a></td>
                 </tr>
               </table>             
              <p style="color: #6b7280; font-size: 13px; margin: 0; line-height: 1.5;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
             </td>
           </tr> 
           <tr>
            <td style="padding: 0 32px;"><hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;" /></td>
           </tr> 
           <tr>
            <td style="padding: 24px 32px 32px 32px; text-align: center;">
              <p style="color: #9ca3af; font-size: 11px; margin: 0 0 8px 0;">Outlook Image Library · Built for professionals</p>
              <p style="color: #df0f19; font-size: 10px; margin: 0;">© ${new Date().getFullYear()} Outlook Newsroom. All rights reserved.</p>
             </td>
           </tr>
         </table>
       </td>
     </tr></table></body></html> `,
    };

    // Log what we're sending (safe subset — no HTML body)
    console.log('Brevo → sending to:', toEmail, '| subject:', payload.subject, '| sender:', payload.sender.email);

    const result = await tranEmailApi.sendTransacEmail(payload);

    // Brevo returns { messageId: '...' } on success
    console.log('Brevo → success, messageId:', result?.messageId || JSON.stringify(result));
    return result;

  } catch (err) {
    // Print the full Brevo API error response so you know exactly why it failed
    const detail = err?.response?.text || err?.response?.body || err?.message || String(err);
    console.error('sendResetEmail FAILED ↓');
    console.error(detail);
    throw new Error(`Brevo send failed: ${detail}`);
  }
};

const sendShareEmail = async (toEmail, senderName, assetTitle, assetPath, customMessage, assetId) => {
  try {
    const client = Sib.ApiClient.instance;
    const apiKey = client.authentications['api-key'];
    
    apiKey.apiKey = process.env.SENDINBLUE_API_KEY;
    const tranEmailApi = new Sib.TransactionalEmailsApi();
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
    const assetViewUrl = `${FRONTEND_URL}/photos/view/${assetId}`;
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Image Shared With You</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <!-- Header with red theme -->
    <div style="background-color: #df0f19; color: #ffffff; padding: 20px; text-align: center; margin: 0;">
      <h2 style="margin: 0; font-size: 24px;">Image Shared With You</h2>
    </div> 
    <div style="padding: 30px; background-color: #f9f9f9;">
      <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
        <strong style="color: #df0f19;">${senderName}</strong> has shared an asset with you from the <strong>Outlook Image Library</strong>.
      </p> 
      <div style="margin: 20px 0; padding: 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center;">
        <div style="font-size: 18px; font-weight: bold; color: #1f2937; margin-bottom: 10px;">${assetTitle}</div>
        <img src="${assetPath}" alt="${assetTitle}" style="max-width: 100%; max-height: 300px; height: auto; border-radius: 4px; margin: 10px 0; object-fit: contain;" />
      </div> 
      ${customMessage ? `
        <div style="margin: 20px 0; padding: 15px; background-color: #fff5f5; border-left: 4px solid #df0f19; text-align: left;">
          <p style="margin: 0 0 5px 0; font-weight: bold; color: #df0f19;">Message from ${senderName}:</p>
          <p style="margin: 10px 0 0 0; color: #333333;">${customMessage.replace(/\n/g, '<br>')}</p>
        </div>
      ` : ''}
      
      <div style="text-align: center; margin: 20px 0;">
        <a href="${assetViewUrl}" style="display: inline-block; background-color: #df0f19; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(223,15,25,0.2);">View Full Details</a>
      </div> 
      <p style="margin: 20px 0 0 0; font-size: 14px; color: #666666; text-align: center;">You can also download this asset directly from the link above.</p>
    </div> 
    <div style="padding: 20px; background-color: #f5f5f5; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">If you didn't expect this email, you can safely ignore it.</p>
      <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;"> © ${new Date().getFullYear()} Outlook Image Library. All rights reserved.</p>
      <p style="margin: 0; font-size: 11px; color: #df0f19;">This is an automated message, please do not reply to this email.</p>
    </div>
  </div></body></html>`;

    const textContent = `${senderName} shared "${assetTitle}" with you.\n\n${customMessage ? customMessage + '\n\n' : ''} View the asset at: ${assetViewUrl}\n\nThis is an automated message from Outlook Image Library.`;

    const payload = {
      sender: { name: 'Outlook Image Library', email: 'noreply@outlookindia.co.in' },
      to: [{ email: toEmail, name: toEmail.split('@')[0] }],
      bcc: [{ email: 'nareshsinha3@gmail.com', name: 'Naresh Sinha' }],
      subject: `${senderName} shared an Image  with you.`, //: ${assetTitle}`,
      htmlContent: htmlContent,
      textContent: textContent,
    };
    console.log('Brevo → sending share email to:', toEmail, '| subject:', payload.subject);
    const result = await tranEmailApi.sendTransacEmail(payload);
    console.log('Brevo → share email sent successfully, messageId:', result?.messageId);
    return result;
  } catch (err) {
    const detail = err?.response?.text || err?.response?.body || err?.message || String(err);
    console.error('sendShareEmail FAILED ↓');
    console.error(detail);
    throw new Error(`Brevo send failed: ${detail}`);
  }
};

// Send welcome email function
const sendWelcomeEmail = async (toEmail, toName, loginEmail, plainPassword) => {
  try {
    const client = Sib.ApiClient.instance;
    const apiKey = client.authentications['api-key'];
    apiKey.apiKey = process.env.SENDINBLUE_API_KEY;
    const tranEmailApi = new Sib.TransactionalEmailsApi();

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
    const loginUrl = `${FRONTEND_URL}/auth`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Outlook Image Library</title>
      </head>
      <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <div style="background-color: #3b82f6; color: #ffffff; padding: 30px 20px; text-align: center;">
            <h2 style="margin: 0; font-size: 24px;">Welcome to Outlook Image Library!</h2>
          </div>
          
          <!-- Content -->
          <div style="padding: 30px; background-color: #f9f9f9;">
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
              Hello <strong style="color: #3b82f6;">${toName}</strong>,
            </p>
            
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
              Your account has been successfully created. You can now access the Outlook Image Library using the credentials below:
            </p>
            
            <div style="margin: 25px 0; padding: 20px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb;">
              <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; color: #3b82f6; margin-bottom: 5px;">Email Address:</div>
                <div style="font-size: 16px; color: #333333;">${loginEmail}</div>
              </div>
              <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; color: #3b82f6; margin-bottom: 5px;">Password:</div>
                <div style="font-size: 16px; color: #333333;">${plainPassword}</div>
              </div>
            </div>
            
            <div style="text-align: center; margin: 25px 0;">
              <a href="${loginUrl}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Login to Your Account</a>
            </div>
            
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>Important Security Note:</strong> For security reasons, we recommend changing your password after your first login. You can do this from your profile settings.
              </p>
            </div>
            
            <p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
              If you have any questions or need assistance, please don't hesitate to contact our support team.
            </p>
          </div>
          
          <!-- Footer -->
          <div style="padding: 20px; background-color: #f5f5f5; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">
              © ${new Date().getFullYear()} Outlook Image Library. All rights reserved.
            </p>
            <p style="margin: 0; font-size: 11px; color: #999999;">
              This is an automated message, please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
      Welcome to Outlook Image Library!
      
      Hello ${toName},
      
      Your account has been successfully created. You can now access the Outlook Image Library using the credentials below:
      
      Email Address: ${loginEmail}
      Password: ${plainPassword}
      
      Login to your account: ${loginUrl}
      
      Important Security Note: For security reasons, we recommend changing your password after your first login. You can do this from your profile settings.
      
      If you have any questions or need assistance, please don't hesitate to contact our support team.
      
      © ${new Date().getFullYear()} Outlook Image Library. All rights reserved.
    `;

    const payload = {
      sender: { name: 'Outlook Image Library', email: 'noreply@outlookindia.co.in' },
      to: [{ email: toEmail, name: toName }],
      bcc: [{ email: 'nareshsinha3@gmail.com', name: 'Naresh Sinha' }],
      subject: 'Welcome to Outlook Image Library - Your Account Credentials',
      htmlContent: htmlContent,
      textContent: textContent,
    };

    console.log('Brevo → sending welcome email to:', toEmail);
    const result = await tranEmailApi.sendTransacEmail(payload);
    console.log('Brevo → welcome email sent successfully, messageId:', result?.messageId);

    return result;

  } catch (err) {
    const detail = err?.response?.text || err?.response?.body || err?.message || String(err);
    console.error('sendWelcomeEmail FAILED ↓');
    console.error(detail);
    // Don't throw error - we don't want to fail user creation if email fails
    console.warn('Welcome email failed to send, but user was created successfully');
  }
};

// Send verification email function
const sendVerificationEmail = async (toEmail, toName, verificationToken) => {
  try {
    const client = Sib.ApiClient.instance;
    const apiKey = client.authentications['api-key'];
    apiKey.apiKey = process.env.SENDINBLUE_API_KEY;

    const tranEmailApi = new Sib.TransactionalEmailsApi();

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
    const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;

    const htmlContent = `<!DOCTYPE html><html><head> <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - Outlook Image Library</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5;">
      <tr>
        <td align="center" style="padding: 20px 0;">
          <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
            <tr>
              <td style="background-color: #df0f19; padding: 30px 20px; text-align: center;">
                <h2 style="margin: 0; color: #ffffff; font-size: 24px;">Verify Your Email Address</h2>
              </td>
            </tr>
            <tr>
              <td style="padding: 30px; background-color: #f9f9f9;">
                <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">Hello <strong style="color: #df0f19;">${toName}</strong>,</p>
                <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">Thank you for registering with <strong>Outlook Image Library</strong>. Please verify your email address to activate your account and start exploring our vast collection of professional images.</p> 
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="padding: 30px 0;">
                      <a href="${verificationUrl}" style="display: inline-block; background-color: #df0f19; color: #ffffff; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(223,15,25,0.2);">Verify Email Address</a>
                    </td>
                  </tr>
                </table> 
                <p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">This verification link will expire in <strong style="color: #df0f19;">24 hours</strong>.</p> 
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
                  <tr>
                    <td style="padding: 15px; background-color: #fff5f5; border-left: 4px solid #df0f19;">
                      <p style="margin: 0; font-size: 14px; color: #4b5563;">
                        <strong style="color: #df0f19;">What happens next?</strong> After verification, you'll be able to login and access all features including downloading images, creating collections, and more.
                      </p>
                    </td>
                  </tr>
                </table> 
                <p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">If you didn't create an account with us, you can safely ignore this email.</p>
              </td>
            </tr> 
            <tr>
              <td style="padding: 20px; background-color: #f5f5f5; text-align: center; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">If you have any questions, please contact our support team.</p>
                <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">© ${new Date().getFullYear()} Outlook Image Library. All rights reserved.</p>
                <p style="margin: 0; font-size: 11px; color: #df0f19;">This is an automated message, please do not reply to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr></table></body></html>`;

    const textContent = `
      Verify Your Email - Outlook Image Library
      
      Hello ${toName},
      
      Thank you for registering with Outlook Image Library. Please verify your email address to activate your account.
      
      Click the link below to verify your email:
      ${verificationUrl}
      
      This verification link will expire in 24 hours.
      
      What happens next? After verification, you'll be able to login and access all features including downloading images, creating collections, and more.
      
      If you didn't create an account with us, you can safely ignore this email.
      
      © ${new Date().getFullYear()} Outlook Image Library. All rights reserved.
    `;

    const payload = {
      sender: { name: 'Outlook Image Library', email: 'noreply@outlookindia.co.in' },
      to: [{ email: toEmail, name: toName }],
      bcc: [{ email: 'nareshsinha3@gmail.com', name: 'Naresh Sinha' }],
      subject: 'Verify Your Email - Outlook Image Library',
      htmlContent: htmlContent,
      textContent: textContent,
    };

    console.log('Brevo → sending verification email to:', toEmail);
    const result = await tranEmailApi.sendTransacEmail(payload);
    console.log('Brevo → verification email sent successfully, messageId:', result?.messageId);

    return result;

  } catch (err) {
    const detail = err?.response?.text || err?.response?.body || err?.message || String(err);
    console.error('sendVerificationEmail FAILED ↓');
    console.error(detail);
    // Don't throw error - we don't want to fail user creation if email fails
    console.warn('Verification email failed to send, but user was created successfully');
  }
};

const sendPasswordChangeEmail = async (toEmail, toName, newPassword) => {
  try {
    const client = Sib.ApiClient.instance;
    const apiKey = client.authentications['api-key'];
    apiKey.apiKey = process.env.SENDINBLUE_API_KEY;

    const tranEmailApi = new Sib.TransactionalEmailsApi();
    
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
    const loginUrl = `${FRONTEND_URL}/auth`;
    const supportEmail = 'support@outlookimage.com';

    const htmlContent = `<!DOCTYPE html> <html> <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed Successfully</title>
      </head>
      <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <!-- Header with red theme -->
          <div style="background-color: #df0f19; color: #ffffff; padding: 30px 20px; text-align: center;">
            <h2 style="margin: 0; font-size: 24px;">Password Changed Successfully</h2>
          </div>
          
          <!-- Content -->
          <div style="padding: 30px; background-color: #f9f9f9;">
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
              Hello <strong style="color: #df0f19;">${toName}</strong>,
            </p>
            
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
              Your password for your <strong>Outlook Image Library</strong> account has been successfully changed.
            </p>
            
            <div style="margin: 25px 0; padding: 20px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb;">
              <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; color: #df0f19; margin-bottom: 8px;">Your New Password:</div>
                <div style="font-size: 18px; font-family: monospace; background-color: #f5f5f5; padding: 10px; border-radius: 6px; word-break: break-all;">${newPassword}</div>
              </div>
            </div>
            
            <div style="background-color: #fff5f5; border-left: 4px solid #df0f19; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px; color: #4b5563;">
                <strong style="color: #df0f19;">Security Tip:</strong> For your account security, please:
              </p>
              <ul style="margin: 10px 0 0 20px; color: #4b5563; font-size: 14px;">
                <li>Do not share your password with anyone</li>
                <li>Use a unique password that you don't use elsewhere</li>
                <li>Consider changing your password regularly</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0 20px 0;">
              <a href="${loginUrl}" style="display: inline-block; background-color: #df0f19; color: #ffffff; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(223,15,25,0.2);">Login to Your Account</a>
            </div>
            
            <p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
              If you did not make this change, please contact our support team immediately at <a href="mailto:${supportEmail}" style="color: #df0f19; text-decoration: none;">${supportEmail}</a> to secure your account.
            </p>
          </div> 
          <div style="padding: 20px; background-color: #f5f5f5; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">This is a confirmation that your password was changed. If you made this change, no further action is required.</p>
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">© ${new Date().getFullYear()} Outlook Image Library. All rights reserved.</p>
            <p style="margin: 0; font-size: 11px; color: #df0f19;">This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
      Password Changed Successfully - Outlook Image Library
      
      Hello ${toName},
      
      Your password for your Outlook Image Library account has been successfully changed.
      
      Your New Password: ${newPassword}
      
      Security Tip: For your account security, please:
      - Do not share your password with anyone
      - Use a unique password that you don't use elsewhere
      - Consider changing your password regularly
      
      Login to your account: ${loginUrl}
      
      If you did not make this change, please contact our support team immediately at ${supportEmail} to secure your account.
      
      This is a confirmation that your password was changed. If you made this change, no further action is required.
      
      © ${new Date().getFullYear()} Outlook Image Library. All rights reserved.
    `;

    const payload = {
      sender: { name: 'Outlook Image Library', email: 'noreply@outlookindia.co.in' },
      to: [{ email: toEmail, name: toName }],
      bcc: [{ email: 'nareshsinha3@gmail.com', name: 'Naresh Sinha' }],
      subject: 'Password Changed Successfully - Outlook Image Library',
      htmlContent: htmlContent,
      textContent: textContent,
    };

    console.log('Brevo → sending password change notification email to:', toEmail);
    const result = await tranEmailApi.sendTransacEmail(payload);
    console.log('Brevo → password change email sent successfully, messageId:', result?.messageId);
    
    return result;

  } catch (err) {
    const detail = err?.response?.text || err?.response?.body || err?.message || String(err);
    console.error('sendPasswordChangeEmail FAILED ↓');
    console.error(detail);
    throw new Error(`Failed to send password change email: ${detail}`);
  }
};

// Send password reset confirmation email
const sendPasswordResetConfirmationEmail = async (toEmail, toName, newPassword) => {
  try {
    const client = Sib.ApiClient.instance;
    const apiKey = client.authentications['api-key'];
    apiKey.apiKey = process.env.SENDINBLUE_API_KEY;

    const tranEmailApi = new Sib.TransactionalEmailsApi();
    
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
    const loginUrl = `${FRONTEND_URL}/auth`;
    const supportEmail = 'support@outlookimage.com';

    const htmlContent = `<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Successful</title>
      </head>
      <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">

          <div style="background-color: #df0f19; color: #ffffff; padding: 30px 20px; text-align: center;">
            <h2 style="margin: 0; font-size: 24px;">Password Reset Successful</h2>
          </div>
          <div style="padding: 30px; background-color: #f9f9f9;">
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">Hello <strong style="color: #df0f19;">${toName}</strong>,</p> 
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">Your password for your <strong>Outlook Image Library</strong> account has been successfully reset.</p> 
            <div style="margin: 25px 0; padding: 20px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb;">
              <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; color: #df0f19; margin-bottom: 8px;">Your New Password:</div>
                <div style="font-size: 18px; font-family: monospace; background-color: #f5f5f5; padding: 10px; border-radius: 6px; word-break: break-all;">${newPassword}</div>
              </div>
            </div>
            
            <div style="background-color: #fff5f5; border-left: 4px solid #df0f19; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px; color: #4b5563;">
                <strong style="color: #df0f19;">Security Tips:</strong> To keep your account secure:
              </p>
              <ul style="margin: 10px 0 0 20px; color: #4b5563; font-size: 14px;">
                <li>Do not share your password with anyone</li>
                <li>Use a unique password that you don't use elsewhere</li>
                <li>Consider changing your password regularly</li>
                <li>Enable two-factor authentication if available</li>
              </ul>
            </div> 
            <div style="text-align: center; margin: 30px 0 20px 0;">
              <a href="${loginUrl}" style="display: inline-block; background-color: #df0f19; color: #ffffff; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(223,15,25,0.2);">Login to Your Account</a>
            </div> 
            <p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
              If you did not request this password reset, please contact our support team immediately at <a href="mailto:${supportEmail}" style="color: #df0f19; text-decoration: none;">${supportEmail}</a> to secure your account.
            </p>
          </div> 
          <div style="padding: 20px; background-color: #f5f5f5; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">This is a confirmation that your password was reset. If you made this change, no further action is required.</p>
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">© ${new Date().getFullYear()} Outlook Image Library. All rights reserved.</p>
            <p style="margin: 0; font-size: 11px; color: #df0f19;">This is an automated message, please do not reply to this email.</p>
          </div>
        </div></body></html>`;

    const textContent = `
      Password Reset Successful - Outlook Image Library
      
      Hello ${toName},
      
      Your password for your Outlook Image Library account has been successfully reset.
      
      Your New Password: ${newPassword}
      
      Security Tips: To keep your account secure:
      - Do not share your password with anyone
      - Use a unique password that you don't use elsewhere
      - Consider changing your password regularly
      - Enable two-factor authentication if available
      
      Login to your account: ${loginUrl}
      
      If you did not request this password reset, please contact our support team immediately at ${supportEmail} to secure your account.
      
      This is a confirmation that your password was reset. If you made this change, no further action is required.
      
      © ${new Date().getFullYear()} Outlook Image Library. All rights reserved.
    `;

    const payload = {
      sender: { name: 'Outlook Image Library', email: 'noreply@outlookindia.co.in' },
      to: [{ email: toEmail, name: toName }],
      bcc: [{ email: 'nareshsinha3@gmail.com', name: 'Naresh Sinha' }],
      subject: 'Password Reset Successful - Outlook Image Library',
      htmlContent: htmlContent,
      textContent: textContent,
    };

    console.log('Brevo → sending password reset confirmation email to:', toEmail);
    const result = await tranEmailApi.sendTransacEmail(payload);
    console.log('Brevo → password reset confirmation email sent successfully, messageId:', result?.messageId);
    
    return result;

  } catch (err) {
    const detail = err?.response?.text || err?.response?.body || err?.message || String(err);
    console.error('sendPasswordResetConfirmationEmail FAILED ↓');
    console.error(detail);
    throw new Error(`Failed to send password reset confirmation email: ${detail}`);
  }
};





export const bulkShareAssets = async (req, res) => {
  console.log('--- bulkShareAssets ---');

  try {
    const { email, assetIds, assetCount, assetPreview, message, senderName, shareLink } = req.body;
    const userId = req.user?.id;

    // Basic validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'A valid email address is required.',
      });
    }

    if (!assetIds || assetIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Asset information is required.',
      });
    }

    // Send bulk share email
    await sendBulkShareEmail(
      email,
      senderName || 'A user',
      assetCount,
      assetPreview,
      message,
      shareLink
    );

    // Optional: Log the share activity
    if (userId) {
      try {
        await Prisma.pam_share_logs.create({
          data: {
            user_id: userId,
            asset_id: assetIds.join(','), // Store as comma-separated string
            recipient_email: email,
            shared_at: new Date(),
          },
        });
        console.log(`Bulk share activity logged for user: ${userId}`);
      } catch (logErr) {
        console.warn('Could not log share activity:', logErr.message);
      }
    }

    console.log(`${assetCount} assets shared via email to: ${email}`);

    return res.status(200).json({
      status: 'success',
      message: `${assetCount} asset(s) shared successfully via email.`,
    });

  } catch (err) {
    console.error('bulkShareAssets error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to send share email. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
};

// Send bulk share email function
const sendBulkShareEmail = async (toEmail, senderName, assetCount, assetPreview, customMessage, shareLink) => {
  try {
    const client = Sib.ApiClient.instance;
    const apiKey = client.authentications['api-key'];
    apiKey.apiKey = process.env.SENDINBLUE_API_KEY;

    const tranEmailApi = new Sib.TransactionalEmailsApi();

    const assetPreviewHtml = assetPreview ? `
      <div class="asset-preview">
        <div class="asset-title">${assetPreview.title}</div>
        <img src="${assetPreview.path}" alt="${assetPreview.title}" class="asset-image" style="max-width: 100%; max-height: 300px; object-fit: contain;" />
      </div>
    ` : '';

    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Assets Shared With You</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <div style="background-color: #df0f19; color: #ffffff; padding: 20px; text-align: center;">
      <h2 style="margin: 0; font-size: 24px;">${assetCount} Asset${assetCount !== 1 ? 's' : ''} Shared With You</h2>
    </div> 
    <div style="padding: 30px; background-color: #f9f9f9;">
      <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
        <strong style="color: #df0f19;">${senderName}</strong> has shared <strong>${assetCount} asset${assetCount !== 1 ? 's' : ''}</strong> with you from the <strong>Outlook Image Library</strong>.
      </p> 
      <div style="text-align: center; margin: 20px 0;">
        <div style="font-size: 32px; font-weight: bold; color: #df0f19; margin: 10px 0;"> ${assetCount} ${assetCount === 1 ? 'Asset' : 'Assets'} </div>
      </div> 
      ${assetPreviewHtml ? `
        <div style="margin: 20px 0; padding: 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center;">
          <div style="font-size: 18px; font-weight: bold; color: #1f2937; margin-bottom: 10px;">${assetPreview.title}</div>
          <img src="${assetPreview.path}" alt="${assetPreview.title}" style="max-width: 100%; height: auto; border-radius: 4px; margin: 10px 0;" />
        </div>
      ` : ''}
      
      ${customMessage ? `
        <div style="margin: 20px 0; padding: 15px; background-color: #fff5f5; border-left: 4px solid #df0f19; text-align: left;">
          <p style="margin: 0 0 5px 0; font-weight: bold; color: #df0f19;">Message from ${senderName}:</p>
          <p style="margin: 10px 0 0 0; color: #333333;">${customMessage.replace(/\n/g, '<br>')}</p>
        </div>
      ` : ''}
      
      <div style="text-align: center; margin: 30px 0 20px 0;">
        <a href="${shareLink}" style="display: inline-block; background-color: #df0f19; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(223,15,25,0.2);">View All ${assetCount} Asset${assetCount !== 1 ? 's' : ''}</a>
      </div>  
      <p style="margin: 20px 0 0 0; font-size: 14px; color: #666666; text-align: center;"> Click the button above to view and download all shared assets. </p>
    </div>
    
    <div style="padding: 20px; background-color: #f5f5f5; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">If you didn't expect this email, you can safely ignore it.</p>
      <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">© ${new Date().getFullYear()} Outlook Image Library. All rights reserved.</p>
      <p style="margin: 0; font-size: 11px; color: #df0f19;">This is an automated message, please do not reply to this email. </p>
    </div>
  </div>
</body>
</html>`;

    const payload = {
      sender: { name: 'Outlook Image Library', email: 'noreply@outlookindia.co.in' },
      to: [{ email: toEmail, name: toEmail.split('@')[0] }],
      bcc: [{ email: 'nareshsinha3@gmail.com', name: 'Naresh Sinha' }],
      subject: `${senderName} shared ${assetCount} asset${assetCount !== 1 ? 's' : ''} with you`,
      htmlContent: htmlContent,
    };

    const result = await tranEmailApi.sendTransacEmail(payload);
    console.log('Brevo → bulk share email sent successfully, messageId:', result?.messageId);

    return result;

  } catch (err) {
    const detail = err?.response?.text || err?.response?.body || err?.message || String(err);
    console.error('sendBulkShareEmail FAILED ↓');
    console.error(detail);
    throw new Error(`Brevo send failed: ${detail}`);
  }
};

// Controller functions for user operations

/**
 * Get all users
 */
export const getAllUsers2222 = async (req, res) => {
  try {
    const allUsers = await Prisma.pam_users.findMany({
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        password_reset_code: true,
        last_ip: true,
        created_at: true,
        updated_at: true,
        email: true,
        password: true,
        is_active: true,
        is_verify: true
      }
    });
    res.json(allUsers);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
};
export const getAllUsers = async (req, res) => {
  console.log("I am in getAllUsers");
  try {
    const users = await Prisma.pam_users.findMany({
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        is_active: true,
        is_verify: true,
        is_admin: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: {
        created_at: 'desc'
      }
    });

    // Format response for frontend
    const formattedUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      display_name: user.username,
      first_name: user.firstname,
      firstname: user.firstname,
      last_name: user.lastname,
      lastname: user.lastname,
      email: user.email,
      mobile: user.mobile_no,
      mobile_no: user.mobile_no,
      address: user.address,
      photo: user.photo,
      role: user.role,
      is_active: user.is_active,
      is_verify: user.is_verify,
      is_admin: user.is_admin,
      created_at: user.created_at,
      updated_at: user.updated_at,
    }));

    res.json({
      status: "success",
      data: formattedUsers
    });
  } catch (err) {
    console.error("Get all users error:", err);
    res.status(500).json({
      status: "error",
      message: "Database error"
    });
  }
};
/**
 * Get users with pagination and filters (for web interface)
 */
export const getWebUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const username = req.query.username?.trim();

    // Allowed sort fields for safety
    const allowedSortFields = [
      'id',
      'username',
      'email',
      'created_at',
      'updated_at',
    ];

    const sortBy = allowedSortFields.includes(req.query.sortBy)
      ? req.query.sortBy
      : 'id';

    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const where = {};

    if (username) {
      where.username = {
        contains: username,
        //mode: 'insensitive',
      };
    }

    const [users, totalRecords] = await Promise.all([
      Prisma.pam_users.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
        select: {
          id: true,
          username: true,
          firstname: true,
          lastname: true,
          email: true,
          mobile_no: true,
          address: true,
          photo: true,
          role: true,
          is_active: true,
          is_verify: true,
          last_ip: true,
          created_at: true,
          updated_at: true,
        },
      }),
      Prisma.pam_users.count({ where }),
    ]);

    res.json({
      status: 'success',
      page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      results: users,
    });

  } catch (err) {
    console.error('WEBUSERS ERROR:', err);
    res.status(500).json({
      status: 'error',
      message: 'Database error',
    });
  }
};

/**
 * Get single user by ID
 */
export const getUserById222 = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID"
      });
    }

    const user = await Prisma.pam_users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
};
export const getUserById = async (req, res) => {
  console.log("I am in getUserById");
  try {
    const userId = parseInt(req.params.id);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID"
      });
    }

    const user = await Prisma.pam_users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        is_active: true,
        is_verify: true,
        is_admin: true,
        created_at: true,
        updated_at: true,
      }
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }

    // Format response for frontend
    const formattedUser = {
      id: user.id,
      username: user.username,
      display_name: user.username, // For frontend compatibility
      first_name: user.firstname, // For frontend compatibility
      firstname: user.firstname,
      last_name: user.lastname, // For frontend compatibility
      lastname: user.lastname,
      email: user.email,
      mobile: user.mobile_no, // For frontend compatibility
      mobile_no: user.mobile_no,
      address: user.address,
      photo: user.photo,
      role: user.role,
      is_active: user.is_active,
      is_verify: user.is_verify,
      is_admin: user.is_admin,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    res.json({
      status: "success",
      data: formattedUser
    });
  } catch (err) {
    console.error("Get user by ID error:", err);
    res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
};
/**
 * User login
 */
export const login = async (req, res) => {
  console.log("@login");
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        status: "error",
        message: "Email and password are required"
      });
    }

    // Find user by email
    const user = await Prisma.pam_users.findFirst({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password"
      });
    }

    // Check account status
    if (user.is_active === 0) {
      return res.json({
        status: "error",
        message: "Account is inactive"
      });
    }

    if (user.is_verify === 0) {
      return res.json({
        status: "error",
        message: "Account not verified"
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({
        status: "error",
        message: "Invalid email or password"
      });
    }

    // Create JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Success response (NO password)
    return res.json({
      status: "success",
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.username,
        username: user.username,
        email: user.email,
        role: user.role,
        bio: 'Professional photographer and visual storyteller.',
        location: 'New Delhi, India',
        website: '',
        avatar:  user.photo, //'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop',
        joinedDate: 'January 2024',
      }
    });
  } catch (err) {
    console.error(err);
    return res.json({
      status: "error",
      message: "Internal server error"
    });
  }
};

/**
 * Update user status (activate/deactivate)
 */
export const updateUserStatus = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { is_active } = req.body;

    // Validate userId
    if (isNaN(userId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid user ID',
      });
    }

    // Validate is_active (only 0 or 1 allowed)
    if (![0, 1].includes(is_active)) {
      return res.status(400).json({
        status: 'error',
        message: 'is_active must be 0 or 1',
      });
    }

    // Update user status
    const user = await Prisma.pam_users.update({
      where: { id: userId },
      data: {
        is_active,
        updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        is_active: true,
      },
    });

    res.json({
      status: 'success',
      message: 'User status updated successfully',
      user,
    });

  } catch (err) {
    console.error(err);

    // Prisma "record not found"
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update user status',
    });
  }
};

/**
 * Create temporary user
 */
export const createTmpUser = async (req, res) => {
  const { user_name, email } = req.body;

  try {
    const users = await Prisma.pam_tmp_user.create({
      data: {
        user_name,
        email
      }
    });

    return res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create user" });
  }
};

/**
 * Update user (with optional photo upload)
 */
export const updateUser33333333 = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id);

    // Validate ID
    if (!id || isNaN(userId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid user ID is required',
      });
    }

    // Build update data
    const data = {
      updated_at: new Date(),
    };

    // Handle string fields
    const fields = ['username', 'firstname', 'lastname', 'email', 'mobile_no', 'address', 'photo', 'role', 'password'];
    fields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== '') {
        data[field] = field === 'role' ? Number(req.body[field]) : req.body[field];
      }
    });

    // Handle boolean fields
    const booleanFields = ['is_active', 'is_verify', 'is_admin'];
    booleanFields.forEach(field => {
      if (req.body[field] !== undefined) {
        data[field] = parseToNumber(req.body[field]);
      }
    });

    // Remove undefined values
    Object.keys(data).forEach(
      (key) => data[key] === undefined && delete data[key]
    );

    // Hash password if provided
    if (req.body.password && req.body.password.trim() !== '') {
      data.password = await bcrypt.hash(req.body.password, 10);
    }

    // Handle file upload if photo is a file
    if (req.files && req.files.photo) {
      const photoFile = req.files.photo;

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(photoFile.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
        });
      }

      const uploadDir = path.join(process.cwd(), 'uploads', 'users');

      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Generate unique filename
      const fileName = `user_${id}_${Date.now()}${path.extname(photoFile.name)}`;
      const filePath = path.join(uploadDir, fileName);

      // Move file to uploads directory
      await photoFile.mv(filePath);

      // Save relative path in database
      data.photo = `/uploads/users/${fileName}`;
    }

    // Validate required fields for update
    if (Object.keys(data).length <= 1) { // Only updated_at is present
      return res.status(400).json({
        status: 'error',
        message: 'No valid data provided for update',
      });
    }

    // Update user
    const user = await Prisma.pam_users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        is_active: true,
        is_verify: true,
        is_admin: true,
        updated_at: true,
      },
    });

    res.json({
      status: 'success',
      message: 'User updated successfully',
      user,
    });
  } catch (err) {
    console.error('Update user error:', err);

    // Handle specific Prisma errors
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Handle unique constraint violations
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(400).json({
        status: 'error',
        message: `${field ? field.charAt(0).toUpperCase() + field.slice(1) : 'Field'} already exists`,
      });
    }

    // Handle invalid data
    if (err.code === 'P2003' || err.code === 'P2006' || err.code === 'P2007') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid data provided',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export const updateUser4444444 = async (req, res) => {
  console.log("I am in updateUser");
  try {
    const { id } = req.params;
    const userId = parseInt(id);

    // Validate ID
    if (!id || isNaN(userId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid user ID is required',
      });
    }

    // Build update data from req.body (multer parses form fields into req.body)
    const data = {
      updated_at: new Date(),
    };

    // Handle string fields
    const fields = ['username', 'firstname', 'lastname', 'email', 'mobile_no', 'address', 'role'];
    
    fields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== '') {
        data[field] = field === 'role' ? Number(req.body[field]) : req.body[field];
      }
    });

    // Handle boolean fields
    const booleanFields = ['is_active', 'is_verify', 'is_admin'];
    booleanFields.forEach(field => {
      if (req.body[field] !== undefined) {
        data[field] = parseInt(req.body[field]);
      }
    });

    // Handle password
    if (req.body.password && req.body.password.trim() !== '') {
      data.password = await bcrypt.hash(req.body.password, 10);
    }

    // Handle file upload from multer
    if (req.file) {
      const uploadDir = path.join(process.cwd(), 'uploads', 'users');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Generate unique filename
      const fileExt = path.extname(req.file.originalname);
      const fileName = `user_${id}_${Date.now()}${fileExt}`;
      const filePath = path.join(uploadDir, fileName);

      // Save file
      fs.writeFileSync(filePath, req.file.buffer);
      
      // Save relative path in database
      data.photo = `/uploads/users/${fileName}`;
    }

    // Remove undefined values
    Object.keys(data).forEach(
      (key) => data[key] === undefined && delete data[key]
    );

    // Update user
    const user = await Prisma.pam_users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        is_active: true,
        is_verify: true,
        is_admin: true,
        updated_at: true,
      },
    });

    res.json({
      status: 'success',
      message: 'User updated successfully',
      user,
    });
  } catch (err) {
    console.error('Update user error:', err);

    // Handle specific Prisma errors
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Handle unique constraint violations
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(400).json({
        status: 'error',
        message: `${field ? field.charAt(0).toUpperCase() + field.slice(1) : 'Field'} already exists`,
      });
    }

    // Handle invalid data
    if (err.code === 'P2003' || err.code === 'P2006' || err.code === 'P2007') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid data provided',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export const updateUser = async (req, res) => {
  console.log("I am in updateUser");
  console.log("Request params:", req.params);
  console.log("Request body:", req.body);
  console.log("Request file:", req.file ? req.file.originalname : "No file");
  console.log("Content-Type:", req.headers['content-type']);
  
  try {
    const { id } = req.params;
    const userId = parseInt(id);

    // Validate ID
    if (!id || isNaN(userId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid user ID is required',
      });
    }

    // Check if user exists
    const existingUser = await Prisma.pam_users.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Build update data
    const data = {
      updated_at: new Date(),
    };

    // Parse body if it's a string (sometimes multer returns body as string)
    let body = req.body;
    if (typeof body === 'string' && body.trim()) {
      try {
        body = JSON.parse(body);
        console.log("Parsed body from string:", body);
      } catch (e) {
        console.log("Could not parse body as JSON");
      }
    }

    // If body is undefined or null, return error
    if (!body || typeof body !== 'object') {
      return res.status(400).json({
        status: 'error',
        message: 'Request body is missing or invalid',
      });
    }

    // Map frontend field names to database field names
    // Handle username/display_name
    if (body.display_name !== undefined && body.display_name !== null) {
      const displayName = String(body.display_name).trim();
      if (displayName) {
        data.username = displayName;
      }
    } else if (body.username !== undefined && body.username !== null) {
      const username = String(body.username).trim();
      if (username) {
        data.username = username;
      }
    }

    // Handle firstname/first_name
    if (body.first_name !== undefined && body.first_name !== null) {
      const firstName = String(body.first_name).trim();
      if (firstName) {
        data.firstname = firstName;
      }
    } else if (body.firstname !== undefined && body.firstname !== null) {
      const firstName = String(body.firstname).trim();
      if (firstName) {
        data.firstname = firstName;
      }
    }

    // Handle lastname/last_name
    if (body.last_name !== undefined && body.last_name !== null) {
      const lastName = String(body.last_name).trim();
      if (lastName) {
        data.lastname = lastName;
      }
    } else if (body.lastname !== undefined && body.lastname !== null) {
      const lastName = String(body.lastname).trim();
      if (lastName) {
        data.lastname = lastName;
      }
    }

    // Handle email
    if (body.email !== undefined && body.email !== null) {
      const email = String(body.email).trim();
      if (email) {
        // Check if email already exists for another user
        if (email !== existingUser.email) {
          const existingEmail = await Prisma.pam_users.findFirst({
            where: {
              email: email,
              id: { not: userId }
            }
          });
          if (existingEmail) {
            return res.status(400).json({
              status: 'error',
              message: 'Email already exists for another user',
            });
          }
        }
        data.email = email;
      }
    }

    // Handle mobile/mobile_no
    if (body.mobile !== undefined && body.mobile !== null) {
      const mobile = String(body.mobile).replace(/[^0-9]/g, '');
      if (mobile.length === 10) {
        if (mobile !== existingUser.mobile_no) {
          const existingMobile = await Prisma.pam_users.findFirst({
            where: {
              mobile_no: mobile,
              id: { not: userId }
            }
          });
          if (existingMobile) {
            return res.status(400).json({
              status: 'error',
              message: 'Mobile number already exists for another user',
            });
          }
        }
        data.mobile_no = mobile;
      } else if (mobile.length > 0 && mobile.length !== 10) {
        return res.status(400).json({
          status: 'error',
          message: 'Mobile number must be exactly 10 digits',
        });
      }
    } else if (body.mobile_no !== undefined && body.mobile_no !== null) {
      const mobile = String(body.mobile_no).replace(/[^0-9]/g, '');
      if (mobile.length === 10) {
        if (mobile !== existingUser.mobile_no) {
          const existingMobile = await Prisma.pam_users.findFirst({
            where: {
              mobile_no: mobile,
              id: { not: userId }
            }
          });
          if (existingMobile) {
            return res.status(400).json({
              status: 'error',
              message: 'Mobile number already exists for another user',
            });
          }
        }
        data.mobile_no = mobile;
      } else if (mobile.length > 0 && mobile.length !== 10) {
        return res.status(400).json({
          status: 'error',
          message: 'Mobile number must be exactly 10 digits',
        });
      }
    }

    // Handle address
    if (body.address !== undefined && body.address !== null) {
      data.address = String(body.address).trim();
    }

    // Handle role
    if (body.role !== undefined && body.role !== null) {
      data.role = parseInt(body.role);
    }

    // Handle is_verify
    if (body.is_verify !== undefined && body.is_verify !== null) {
      data.is_verify = parseInt(body.is_verify);
    }

    // Handle is_active
    if (body.is_active !== undefined && body.is_active !== null) {
      data.is_active = parseInt(body.is_active);
    }

    // Handle is_admin
    if (body.is_admin !== undefined && body.is_admin !== null) {
      data.is_admin = parseInt(body.is_admin);
    }

    // Handle password (only if provided and not empty)
    if (body.password && String(body.password).trim() !== '') {
      const password = String(body.password);
      if (password.length < 6) {
        return res.status(400).json({
          status: 'error',
          message: 'Password must be at least 6 characters long',
        });
      }
      data.password = await bcrypt.hash(password, 10);
    }

    // Handle file upload (profile photo)
    if (req.file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
        });
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024;
      if (req.file.size > maxSize) {
        return res.status(400).json({
          status: 'error',
          message: 'File size too large. Maximum size is 5 MB.'
        });
      }

      // Create upload directory if it doesn't exist
      const uploadDir = path.join(process.cwd(), 'uploads', 'users');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Generate unique filename
      const fileExt = path.extname(req.file.originalname);
      const fileName = `user_${userId}_${Date.now()}${fileExt}`;
      const filePath = path.join(uploadDir, fileName);

      // Save file
      fs.writeFileSync(filePath, req.file.buffer);

      // Delete old photo if it exists and is a local file
      if (existingUser.photo && existingUser.photo.startsWith('/uploads/')) {
        const oldPath = path.join(process.cwd(), existingUser.photo);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
          console.log('Deleted old photo:', oldPath);
        }
      }

      // Save relative path in database
      data.photo = `/uploads/users/${fileName}`;
    }

    // If no data to update (only updated_at)
    if (Object.keys(data).length <= 1) {
      return res.status(400).json({
        status: 'error',
        message: 'No valid data provided for update',
      });
    }

    console.log("Updating user with data:", JSON.stringify(data, null, 2));

    // Update user
    const updatedUser = await Prisma.pam_users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        is_active: true,
        is_verify: true,
        is_admin: true,
        updated_at: true,
      },
    });

    console.log("User updated successfully:", updatedUser.id);

    // Format response for frontend
    const formattedUser = {
      id: updatedUser.id,
      username: updatedUser.username,
      display_name: updatedUser.username,
      first_name: updatedUser.firstname,
      firstname: updatedUser.firstname,
      last_name: updatedUser.lastname,
      lastname: updatedUser.lastname,
      email: updatedUser.email,
      mobile: updatedUser.mobile_no,
      mobile_no: updatedUser.mobile_no,
      address: updatedUser.address,
      photo: updatedUser.photo,
      role: updatedUser.role,
      is_active: updatedUser.is_active,
      is_verify: updatedUser.is_verify,
      is_admin: updatedUser.is_admin,
      updated_at: updatedUser.updated_at,
    };

    res.json({
      status: 'success',
      message: 'User updated successfully',
      user: formattedUser,
    });

  } catch (err) {
    console.error('Update user error:', err);

    // Handle specific Prisma errors
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Handle unique constraint violations
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(400).json({
        status: 'error',
        message: `${field ? field.charAt(0).toUpperCase() + field.slice(1) : 'Field'} already exists`,
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};


export const updateOwnAccountFileUpload = async (req, res) => {
  console.log('--- updateOwnAccount ---');
  console.log('Params :', req.params);
  console.log('Body   :', req.body);
  console.log('File   :', req.file ? { name: req.file.originalname, size: req.file.size } : 'none');
  console.log('Content-Type:', req.headers['content-type']);

  try {
    const { id } = req.params;
    const userId = parseInt(id);

    if (!id || isNaN(userId)) {
      return res.status(400).json({ status: 'error', message: 'Valid user ID is required' });
    }

    // ── Find existing user ──────────────────────────────────────────────────
    const existingUser = await Prisma.pam_users.findUnique({ where: { id: userId } });
    if (!existingUser) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // ── Build update payload ────────────────────────────────────────────────
    const data = { updated_at: new Date() };

    const textFields = ['firstname', 'lastname', 'mobile_no', 'address'];

    textFields.forEach(field => {
      // req.body is populated for BOTH multipart (by multer) and JSON (by express.json())
      const value = req.body?.[field];
      if (value === undefined || value === null || value === '') return;

      if (field === 'mobile_no') {
        const cleaned = String(value).replace(/[^0-9]/g, '');
        if (cleaned.length !== 10) {
          // We can't return inside forEach cleanly, so we flag it
          data.__mobileError = true;
          return;
        }
        data[field] = cleaned;
      } else {
        data[field] = String(value).trim();
      }

      console.log(`  ${field}:`, data[field]);
    });

    // Return early if mobile validation failed
    if (data.__mobileError) {
      delete data.__mobileError;
      return res.status(400).json({ status: 'error', message: 'Mobile number must be exactly 10 digits' });
    }
    delete data.__mobileError;

    // ── Handle photo upload (multer puts file in req.file) ──────────────────
    if (req.file) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
        });
      }

      const maxSize = 5 * 1024 * 1024; // 5 MB
      if (req.file.size > maxSize) {
        return res.status(400).json({
          status: 'error',
          message: 'File size too large. Maximum size is 5 MB.'
        });
      }

      // Write buffer to disk (multer memoryStorage stores it in req.file.buffer)
      const uploadDir = path.join(process.cwd(), 'uploads', 'users');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const ext = path.extname(req.file.originalname);
      const fileName = `user_${userId}_${Date.now()}${ext}`;
      const filePath = path.join(uploadDir, fileName);

      fs.writeFileSync(filePath, req.file.buffer);

      // Delete old photo if it was a local file
      if (existingUser.photo && existingUser.photo.startsWith('/uploads/')) {
        const oldPath = path.join(process.cwd(), existingUser.photo);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
          console.log('Deleted old photo:', oldPath);
        }
      }

      data.photo = `/uploads/users/${fileName}`;
      console.log('New photo saved:', data.photo);
    }

    // ── Guard: nothing to update ────────────────────────────────────────────
    // data always contains updated_at, so check for > 1 key
    if (Object.keys(data).length <= 1) {
      return res.status(400).json({ status: 'error', message: 'No valid data provided for update' });
    }

    console.log('Updating user with data:', data);

    // ── Persist ─────────────────────────────────────────────────────────────
    const updatedUser = await Prisma.pam_users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        mobile_no: true,
        address: true,
        photo: true,
        updated_at: true,
      },
    });

    console.log('User updated successfully:', updatedUser.id);

    return res.json({
      status: 'success',
      message: 'Profile updated successfully',
      user: updatedUser,
    });

  } catch (err) {
    console.error('updateOwnAccount error:', err);

    if (err.code === 'P2025') return res.status(404).json({ status: 'error', message: 'User not found' });
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(400).json({ status: 'error', message: `${field} already exists` });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export const updateOwnAccountNODBUPDATE = async (req, res) => {
  console.log('--- updateOwnAccount ---');
  console.log('Params :', req.params);
  console.log('Body   :', req.body);
  console.log('File   :', req.file ? { name: req.file.originalname, size: req.file.size } : 'none');
  console.log('Content-Type:', req.headers['content-type']);

  try {
    const { id } = req.params;
    const userId = parseInt(id);

    if (!id || isNaN(userId)) {
      return res.status(400).json({ status: 'error', message: 'Valid user ID is required' });
    }

    // ── Find existing user ──────────────────────────────────────────────────
    const existingUser = await Prisma.pam_users.findUnique({ where: { id: userId } });
    if (!existingUser) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // ── Build update payload ────────────────────────────────────────────────
    const data = { updated_at: new Date() };

    const textFields = ['firstname', 'lastname', 'mobile_no', 'address'];

    textFields.forEach(field => {
      const value = req.body?.[field];
      if (value === undefined || value === null || value === '') return;

      if (field === 'mobile_no') {
        const cleaned = String(value).replace(/[^0-9]/g, '');
        if (cleaned.length !== 10) {
          data.__mobileError = true;
          return;
        }
        data[field] = cleaned;
      } else {
        data[field] = String(value).trim();
      }

      console.log(`  ${field}:`, data[field]);
    });

    // Return early if mobile validation failed
    if (data.__mobileError) {
      delete data.__mobileError;
      return res.status(400).json({ status: 'error', message: 'Mobile number must be exactly 10 digits' });
    }
    delete data.__mobileError;

    // ── Handle photo upload → S3 ────────────────────────────────────────────
    if (req.file) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
        });
      }

      const maxSize = 5 * 1024 * 1024; // 5 MB
      if (req.file.size > maxSize) {
        return res.status(400).json({
          status: 'error',
          message: 'File size too large. Maximum size is 5 MB.'
        });
      }

      // ── Build unique S3 keys (same naming convention as gallery uploads) ──
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const fileExtension = path.extname(req.file.originalname);
      const fileName = `${timestamp}_${randomString}${fileExtension}`;

      const s3Key = `uploads/testing/users/${fileName}`;
      const s3ThumbKey = `uploads/testing/users/thumbnails/${fileName}`;
      const fileBuffer = req.file.buffer;

      // ── Upload original to S3 ─────────────────────────────────────────────
      const mainFileUrl = await uploadToS3Direct(fileBuffer, s3Key, req.file.mimetype, true);
      console.log('Profile photo uploaded to S3:', mainFileUrl);

      // ── Generate & upload 400×400 thumbnail to S3 ─────────────────────────
      const thumbnailBuffer = await sharp(fileBuffer)
        .resize({
          width: 400,
          height: 400,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toBuffer();

      const thumbUrl = await uploadToS3Direct(thumbnailBuffer, s3ThumbKey, req.file.mimetype, true);
      console.log('Profile thumbnail uploaded to S3:', thumbUrl);

      // ── Delete old S3 photo + thumbnail (best-effort, non-blocking) ───────
      if (existingUser.photo) {
        try {
          // Derive S3 key from the stored public URL
          // e.g. "https://bucket.s3.region.amazonaws.com/uploads/users/abc.jpg"
          //   → key = "uploads/users/abc.jpg"
          const urlObj = new URL(existingUser.photo);
          const oldKey = urlObj.pathname.replace(/^\//, ''); // strip leading "/"

          await deleteFromS3(oldKey);
          console.log('Deleted old S3 photo:', oldKey);

          // Delete thumbnail at the conventional sibling path
          const oldThumbKey = oldKey.replace('uploads/testing/users/', 'uploads/testing/users/thumbnails/');
          await deleteFromS3(oldThumbKey);
          console.log('Deleted old S3 thumbnail:', oldThumbKey);
        } catch (delErr) {
          // Non-fatal — log and continue
          console.warn('Could not delete old S3 photo (non-fatal):', delErr.message);
        }
      }

      // Store the full public URL of the original in the DB
      data.photo = mainFileUrl;
      console.log('New photo URL saved to DB:', data.photo);
    }

    // ── Guard: nothing to update ────────────────────────────────────────────
    if (Object.keys(data).length <= 1) {
      return res.status(400).json({ status: 'error', message: 'No valid data provided for update' });
    }

    console.log('Updating user with data:', data);

    // ── Persist ─────────────────────────────────────────────────────────────
    const updatedUser = await Prisma.pam_users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        mobile_no: true,
        address: true,
        photo: true,
        updated_at: true,
      },
    });

    console.log('User updated successfully:', updatedUser.id);

    return res.json({
      status: 'success',
      message: 'Profile updated successfully',
      user: updatedUser,
    });

  } catch (err) {
    console.error('updateOwnAccount error:', err);

    if (err.code === 'P2025') return res.status(404).json({ status: 'error', message: 'User not found' });
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(400).json({ status: 'error', message: `${field} already exists` });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export const updateOwnAccount = async (req, res) => {
  console.log('--- updateOwnAccount ---');
  console.log('Params :', req.params);
  console.log('Body   :', req.body);
  console.log('File   :', req.file ? { name: req.file.originalname, size: req.file.size } : 'none');
  console.log('Content-Type:', req.headers['content-type']);

  try {
    const { id } = req.params;
    const userId = parseInt(id);

    if (!id || isNaN(userId)) {
      return res.status(400).json({ status: 'error', message: 'Valid user ID is required' });
    }

    // ── Find existing user ──────────────────────────────────────────────────
    const existingUser = await Prisma.pam_users.findUnique({ where: { id: userId } });
    if (!existingUser) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // ── Build update payload ────────────────────────────────────────────────
    const data = { updated_at: new Date() };

    const textFields = ['firstname', 'lastname', 'mobile_no', 'address'];

    textFields.forEach(field => {
      const value = req.body?.[field];
      if (value === undefined || value === null || value === '') return;

      if (field === 'mobile_no') {
        const cleaned = String(value).replace(/[^0-9]/g, '');
        if (cleaned.length !== 10) {
          data.__mobileError = true;
          return;
        }
        data[field] = cleaned;
      } else {
        data[field] = String(value).trim();
      }

      console.log(`  ${field}:`, data[field]);
    });

    // Return early if mobile validation failed
    if (data.__mobileError) {
      delete data.__mobileError;
      return res.status(400).json({ status: 'error', message: 'Mobile number must be exactly 10 digits' });
    }
    delete data.__mobileError;

    // ── Handle photo upload → S3 ────────────────────────────────────────────
    if (req.file) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
        });
      }

      const maxSize = 5 * 1024 * 1024; // 5 MB
      if (req.file.size > maxSize) {
        return res.status(400).json({
          status: 'error',
          message: 'File size too large. Maximum size is 5 MB.'
        });
      }

      // ── Build unique S3 keys (same naming convention as gallery uploads) ──
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const fileExtension = path.extname(req.file.originalname);
      const fileName = `${timestamp}_${randomString}${fileExtension}`;

      const s3Key = `uploads/testing/users/${fileName}`;
      const s3ThumbKey = `uploads/testing/users/thumbnails/${fileName}`;
      const fileBuffer = req.file.buffer;

      // ── Upload original to S3 ─────────────────────────────────────────────
      const mainFileUrl = await uploadToS3Direct(fileBuffer, s3Key, req.file.mimetype, true);
      console.log('Profile photo uploaded to S3:', mainFileUrl);

      // ── Generate & upload 400×400 thumbnail to S3 ─────────────────────────
      const thumbnailBuffer = await sharp(fileBuffer)
        .resize({
          width: 400,
          height: 400,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toBuffer();

      const thumbUrl = await uploadToS3Direct(thumbnailBuffer, s3ThumbKey, req.file.mimetype, true);
      console.log('Profile thumbnail uploaded to S3:', thumbUrl);

      // ── Delete old S3 photo + thumbnail (best-effort, non-blocking) ───────
      if (existingUser.photo) {
        try {
          // DB stores relative key: "testing/users/<file>"
          // S3 full key needs "uploads/" prefix: "uploads/testing/users/<file>"
          const oldRelKey = existingUser.photo; // e.g. "testing/users/abc.jpg"
          const oldKey = `uploads/${oldRelKey}`;
          const oldThumbKey = oldKey.replace('testing/users/', 'testing/users/thumbnails/');

          await deleteFromS3(oldKey);
          console.log('Deleted old S3 photo:', oldKey);

          await deleteFromS3(oldThumbKey);
          console.log('Deleted old S3 thumbnail:', oldThumbKey);
        } catch (delErr) {
          // Non-fatal — log and continue
          console.warn('Could not delete old S3 photo (non-fatal):', delErr.message);
        }
      }

      // Store only the relative S3 key in DB
      // Full URL: https://oli-photoassets.s3.amazonaws.com/uploads/testing/users/<file>
      // Stored:   testing/users/<file>  (strips leading "uploads/")
      data.photo = s3Key.replace(/^uploads\//, '');
      console.log('New photo key saved to DB:', data.photo); // → "testing/users/<fileName>
    }

    // ── Guard: nothing to update ────────────────────────────────────────────
    if (Object.keys(data).length <= 1) {
      return res.status(400).json({ status: 'error', message: 'No valid data provided for update' });
    }

    console.log('Updating user with data:', data);

    // ── Persist ─────────────────────────────────────────────────────────────
    const updatedUser = await Prisma.pam_users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        mobile_no: true,
        address: true,
        photo: true,
        updated_at: true,
      },
    });

    console.log('User updated successfully:', updatedUser.id);

    return res.json({
      status: 'success',
      message: 'Profile updated successfully',
      user: updatedUser,
    });

  } catch (err) {
    console.error('updateOwnAccount error:', err);

    if (err.code === 'P2025') return res.status(404).json({ status: 'error', message: 'User not found' });
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(400).json({ status: 'error', message: `${field} already exists` });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export const changePassword22 = async (req, res) => {
  console.log('--- changePassword ---');

  try {
    // ── Get user id from JWT token (set by authenticateToken middleware) ────
    const userId = parseInt(req.user?.id);
    if (!userId || isNaN(userId)) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body;

    // ── Validate inputs ─────────────────────────────────────────────────────
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'currentPassword and newPassword are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'New password must be at least 6 characters long',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'New password must be different from the current password',
      });
    }

    // ── Fetch user from DB ───────────────────────────────────────────────────
    const user = await Prisma.pam_users.findUnique({
      where: { id: userId },
      select: { id: true, password: true, is_active: true },
    });

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ status: 'error', message: 'Account is inactive' });
    }

    // ── Verify current password ──────────────────────────────────────────────
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        status: 'error',
        message: 'Current password is incorrect',
      });
    }

    // ── Hash new password & update ───────────────────────────────────────────
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await Prisma.pam_users.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        updated_at: new Date(),
      },
    });

    console.log(`Password updated for user id: ${userId}`);

    return res.json({
      status: 'success',
      message: 'Password changed successfully',
    });

  } catch (err) {
    console.error('changePassword error:', err);

    if (err.code === 'P2025') {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Failed to change password',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export const changePassword = async (req, res) => {
  console.log('--- changePassword ---');

  try {
    // ── Get user id from JWT token (set by authenticateToken middleware) ────
    const userId = parseInt(req.user?.id);
    if (!userId || isNaN(userId)) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body;

    // ── Validate inputs ─────────────────────────────────────────────────────
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'currentPassword and newPassword are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'New password must be at least 6 characters long',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'New password must be different from the current password',
      });
    }

    // ── Fetch user from DB ───────────────────────────────────────────────────
    const user = await Prisma.pam_users.findUnique({
      where: { id: userId },
      select: { 
        id: true, 
        password: true, 
        is_active: true,
        email: true,
        firstname: true,
        lastname: true,
        username: true
      },
    });

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ status: 'error', message: 'Account is inactive' });
    }

    // ── Verify current password ──────────────────────────────────────────────
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        status: 'error',
        message: 'Current password is incorrect',
      });
    }

    // ── Hash new password & update ───────────────────────────────────────────
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await Prisma.pam_users.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        updated_at: new Date(),
      },
    });

    console.log(`Password updated for user id: ${userId}`);

    // ── Send password change notification email ───────────────────────────────
    try {
      await sendPasswordChangeEmail(
        user.email,
        `${user.firstname} ${user.lastname}`,
        newPassword
      );
      console.log(`Password change notification email sent to: ${user.email}`);
    } catch (emailErr) {
      // Don't fail the password change if email fails
      console.error('Failed to send password change email:', emailErr);
    }

    return res.json({
      status: 'success',
      message: 'Password changed successfully. A confirmation email has been sent to your registered email address.',
    });

  } catch (err) {
    console.error('changePassword error:', err);

    if (err.code === 'P2025') {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Failed to change password',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export const forgotPassword = async (req, res) => {
  console.log('--- forgotPassword ---');

  try {
    const { email } = req.body;

    // Basic validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'A valid email address is required.',
      });
    }

    const user = await Prisma.pam_users.findFirst({ where: { email } });

    // Always return success — don't reveal whether the email exists
    if (!user) {
      return res.status(200).json({
        status: 'success',
        message: 'If that email is registered, a reset link has been sent.',
      });
    }

    // Generate a secure random plain token — only its hash is stored in DB
    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Store "hash|isoExpiry" in password_reset_code column
    await Prisma.pam_users.update({
      where: { id: user.id },
      data: {
        password_reset_code: `${hashedToken}|${expiresAt.toISOString()}`,
        updated_at: new Date(),
      },
    });

    // Reset link points to /auth?token= (handled inside Auth.tsx, mode='reset')
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
    const resetLink = `${FRONTEND_URL}/auth?token=${plainToken}`;

    await sendResetEmail(user.email, `${user.firstname} ${user.lastname}`, resetLink);
    console.log(`Reset email sent to: ${user.email}`);

    return res.status(200).json({
      status: 'success',
      message: 'If that email is registered, a reset link has been sent.',
    });

  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to process request. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
}

export const resetPassword = async (req, res) => {
  console.log('--- resetPassword ---');

  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'Token and newPassword are required.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'Password must be at least 6 characters long.',
      });
    }

    // Re-hash the plain token to match what's stored in DB
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // password_reset_code is stored as "hashedToken|isoExpiryDate"
    // Use startsWith to find the matching record
    const user = await Prisma.pam_users.findFirst({
      where: {
        password_reset_code: { startsWith: hashedToken },
      },
      select: {
        id: true,
        email: true,
        firstname: true,
        lastname: true,
        username: true,
        password_reset_code: true,
        updated_at: true,
      },
    });

    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired reset link. Please request a new one.',
      });
    }

    // Parse the expiry date from the stored value
    const [, expiryStr] = (user.password_reset_code || '').split('|');

    if (!expiryStr || new Date(expiryStr) < new Date()) {
      // Clear the stale token and inform the user
      await Prisma.pam_users.update({
        where: { id: user.id },
        data: { password_reset_code: '', updated_at: new Date() },
      });
      return res.status(400).json({
        status: 'error',
        message: 'Reset link has expired. Please request a new one.',
      });
    }

    // Hash the new password and save — clear the token so it can't be reused
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await Prisma.pam_users.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        password_reset_code: '',   // invalidate immediately after use
        updated_at: new Date(),
      },
    });

    console.log(`Password reset successfully for user id: ${user.id}`);

    // ── Send password reset confirmation email ───────────────────────────────
    try {
      await sendPasswordResetConfirmationEmail(
        user.email,
        `${user.firstname} ${user.lastname}`,
        newPassword
      );
      console.log(`Password reset confirmation email sent to: ${user.email}`);
    } catch (emailErr) {
      // Don't fail the password reset if email fails
      console.error('Failed to send password reset confirmation email:', emailErr);
    }

    return res.status(200).json({
      status: 'success',
      message: 'Password has been reset successfully. A confirmation email has been sent to your registered email address. You can now sign in.',
    });

  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to reset password. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
};


// Share asset via email endpoint
export const photoShare = async (req, res) => {
  console.log('--- photoShare ---');
  try {
    const { email, assetId, assetTitle, assetPath, message, senderName } = req.body;
    const userId = req.user?.id; // From auth middleware

    // Basic validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'A valid email address is required.',
      });
    }

    if (!assetId || !assetTitle || !assetPath) {
      return res.status(400).json({
        status: 'error',
        message: 'Asset information is required.',
      });
    }

    // Send share email
    await sendShareEmail(
      email,
      senderName || 'A user',
      assetTitle,
      assetPath,
      message,
      assetId
    );

    // Optional: Log the share activity if user is authenticated
    if (userId) {
      try {
        // Check if share_logs table exists, if not, log to console
        await Prisma.pam_share_logs.create({
          data: {
            user_id: userId,
            asset_id: assetId,
            recipient_email: email,
            shared_at: new Date(),
          },
        });
        console.log(`Share activity logged for user: ${userId}, asset: ${assetId}`);
      } catch (logErr) {
        // Non-fatal - just log the error
        console.warn('Could not log share activity:', logErr.message);
      }
    }

    console.log(`Asset shared via email to: ${email}`);

    return res.status(200).json({
      status: 'success',
      message: 'Asset shared successfully via email.',
    });

  } catch (err) {
    console.error('shareAsset error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to send share email. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }


};

/**
 * Create new user
 */
export const createUser2222 = async (req, res) => {
  console.log("~createUser~");
  try {
    const {
      username,
      firstname,
      lastname,
      email,
      mobile_no,
      password,
      address
    } = req.body;
    console.log(req.body);

    // Basic validation
    if (!username || !firstname || !lastname || !email || !password) {
      return res.status(400).json({
        status: "error",
        message: "Required fields are missing"
      });
    }

    // Check if email exists
    const existingUser = await Prisma.pam_users.findFirst({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "Email already registered"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate token
    const token = jwt.sign(
      { email },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '7d' }
    );

    // Create user
    const user = await Prisma.pam_users.create({
      data: {
        username,
        firstname,
        lastname,
        email,
        mobile_no: mobile_no || '',
        password: hashedPassword,
        address: address || '',
        photo: '',
        role: 1,
        is_active: 1,
        is_verify: 1,
        is_admin: 0,
        token,
        password_reset_code: '',
        last_ip: req.ip,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Remove sensitive fields
    const safeUser = {
      id: user.id,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      mobile_no: user.mobile_no,
      role: user.role,
      token: user.token
    };

    res.status(201).json({
      status: "success",
      message: "User created successfully",
      user: safeUser
    });
  } catch (err) {
    console.error('Create User Error:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to create user"
    });
  }
};

export const createUser222 = async (req, res) => {
  console.log("~createUser~");
  console.log("Request body:", req.body);
  //console.log("Request file:", req.file);
  //return;

  try {
    // Since you're sending FormData, the fields will be in req.body
    // But with express-fileupload, you need to access them like this
    const {
      username,
      firstname,
      lastname,
      email,
      mobile_no,
      password,
      address,
      role = '1',
      is_verify = '0',
      is_active = '1',
      is_admin = '0'
    } = req.body;

    console.log("Extracted data:", {
      username,
      firstname,
      lastname,
      email,
      mobile_no,
      password,
      address
    });

    // Basic validation
    if (!username || !firstname || !lastname || !email || !password) {
      return res.status(400).json({
        status: "error",
        message: "Required fields: username, firstname, lastname, email, password"
      });
    }

    // Check if email exists
    const existingUser = await Prisma.pam_users.findFirst({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "Email already registered"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate token
    const token = jwt.sign(
      { email },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '7d' }
    );

    // Handle file upload if photo exists
    let photoPath = '';
    if (req.files && req.files.photo) {
      const photoFile = req.files.photo;

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(photoFile.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
        });
      }

      const uploadDir = path.join(process.cwd(), 'uploads', 'users');

      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Generate unique filename
      const fileName = `user_${Date.now()}${path.extname(photoFile.name)}`;
      const filePath = path.join(uploadDir, fileName);

      // Move file to uploads directory
      await photoFile.mv(filePath);

      // Save relative path
      photoPath = `/uploads/users/${fileName}`;
    }

    // Create user
    const user = await Prisma.pam_users.create({
      data: {
        username,
        firstname,
        lastname,
        email,
        mobile_no: mobile_no || '',
        password: hashedPassword,
        address: address || '',
        photo: photoPath,
        role: parseInt(role) || 1,
        is_active: parseInt(is_active) || 1,
        is_verify: parseInt(is_verify) || 0,
        is_admin: parseInt(is_admin) || 0,
        token,
        password_reset_code: '',
        last_ip: req.ip,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Remove sensitive fields
    const safeUser = {
      id: user.id,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      mobile_no: user.mobile_no,
      role: user.role,
      token: user.token
    };

    res.status(201).json({
      status: "success",
      message: "User created successfully",
      user: safeUser
    });
  } catch (err) {
    console.error('Create User Error:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to create user",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Create new user (registration)
 */
export const createUser = async (req, res) => {
  console.log("~createUser~");
  console.log("Request body:", req.body);

  try {
    // Extract all fields from request body
    const {
      display_name,      // Display Name
      first_name,        // First Name
      last_name,         // Last Name
      email,             // Email Address
      mobile,            // Mobile Number
      password           // Password
    } = req.body;

    console.log("Extracted data:", {
      display_name,
      first_name,
      last_name,
      email,
      mobile,
      password: password ? '[HIDDEN]' : undefined
    });

    // Basic validation - all fields required
    if (!display_name || !first_name || !last_name || !email || !mobile || !password) {
      return res.status(400).json({
        status: "error",
        message: "All fields are required: display_name, first_name, last_name, email, mobile, password"
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        status: "error",
        message: "Please enter a valid email address"
      });
    }

    // Mobile number validation (10 digits)
    const mobileRegex = /^[0-9]{10}$/;
    if (!mobileRegex.test(mobile)) {
      return res.status(400).json({
        status: "error",
        message: "Please enter a valid 10-digit mobile number"
      });
    }

    // Password validation (minimum 6 characters)
    if (password.length < 6) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters long"
      });
    }

    // Check if email already exists
    const existingUserByEmail = await Prisma.pam_users.findFirst({
      where: { email }
    });

    if (existingUserByEmail) {
      return res.status(409).json({
        status: "error",
        message: "Email already registered"
      });
    }

    // Check if mobile number already exists
    const existingUserByMobile = await Prisma.pam_users.findFirst({
      where: { mobile_no: mobile }
    });

    if (existingUserByMobile) {
      return res.status(409).json({
        status: "error",
        message: "Mobile number already registered"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate token for email verification
    const token = jwt.sign(
      { email, mobile },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '7d' }
    );

    // Create username from display_name (remove spaces and special chars)
    const username = display_name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    // Create user in database
    const user = await Prisma.pam_users.create({
      data: {
        username: username,
        firstname: first_name,
        lastname: last_name,
        email: email,
        mobile_no: mobile,
        password: hashedPassword,
        address: '',  // Optional field
        photo: '',    // Will be set later if user uploads photo
        role: 1,      // Default role (regular user)
        is_active: 0, // Account inactive until email verification
        is_verify: 0, // Not verified yet
        is_admin: 0,  // Not an admin
        token: token,
        password_reset_code: '',
        last_ip: req.ip || req.connection.remoteAddress,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Send welcome email with login credentials
    // await sendWelcomeEmail(
    //   user.email,
    //   `${user.firstname} ${user.lastname}`,
    //   user.email,
    //   password // Send the plain password (not hashed)
    // );

    // Send verification email
    await sendVerificationEmail(
      user.email,
      `${user.firstname} ${user.lastname}`,
      token
    );

    // Remove sensitive fields from response
    const safeUser = {
      id: user.id,
      username: user.username,
      display_name: display_name,
      first_name: user.firstname,
      last_name: user.lastname,
      email: user.email,
      mobile: user.mobile_no,
      role: user.role
    };

    // TODO: Send verification email here
    // await sendVerificationEmail(email, token);

    res.status(201).json({
      status: "success",
      message: "User registered successfully. Please check your email for verification.",
      user: safeUser,
      token: token // Include token if you want auto-login after registration
    });

  } catch (err) {
    console.error('Create User Error:', err);

    // Handle specific Prisma errors
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(409).json({
        status: "error",
        message: `${field === 'email' ? 'Email' : 'Field'} already exists`
      });
    }

    res.status(500).json({
      status: "error",
      message: "Failed to create user. Please try again later.",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};


export const verifyEmail = async (req, res) => {
  console.log('--- verifyEmail ---');

  try {
    const { token } = req.query;

    console.log('Received token:', token);
    console.log('Token length:', token?.length);

    if (!token) {
      return res.status(400).json({
        status: 'error',
        message: 'Verification token is required',
      });
    }

    // First, verify the JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
      console.log('Decoded token:', decoded);
    } catch (err) {
      console.error('Token verification failed:', err.message);
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification token',
      });
    }

    const { email } = decoded;
    console.log('Email from token:', email);

    // Find user by email only first (for debugging)
    const userByEmail = await Prisma.pam_users.findFirst({
      where: { email: email },
    });
    console.log('User found by email:', userByEmail ? {
      id: userByEmail.id,
      email: userByEmail.email,
      token: userByEmail.token ? 'present' : 'null',
      token_value: userByEmail.token,
      is_verify: userByEmail.is_verify,
      is_active: userByEmail.is_active,
    } : 'Not found');

    // Now find user with all conditions
    const user = await Prisma.pam_users.findFirst({
      where: {
        email: email,
        token: token, // Exact token match
        is_verify: 0,
        is_active: 0,
      },
    });

    console.log('Final user query result:', user ? {
      id: user.id,
      email: user.email,
      is_verify: user.is_verify,
      is_active: user.is_active,
      token_matches: user.token === token,
    } : 'No user found matching all criteria');

    if (!user) {
      // Check if user exists but already verified
      const existingUser = await Prisma.pam_users.findFirst({
        where: { email: email },
      });

      if (existingUser && existingUser.is_verify === 1) {
        return res.status(400).json({
          status: 'error',
          message: 'Email already verified. Please login.',
        });
      }

      if (existingUser && existingUser.token !== token) {
        console.log('Token mismatch. Expected:', existingUser.token, 'Received:', token);
        return res.status(400).json({
          status: 'error',
          message: 'Invalid verification token. Please request a new one.',
        });
      }

      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification link',
      });
    }

    // Update user
    const updatedUser = await Prisma.pam_users.update({
      where: { id: user.id },
      data: {
        is_verify: 1,
        is_active: 1,
        token: '', // Clear the token after verification
        updated_at: new Date(),
      },
    });

    console.log('User verified successfully:', updatedUser.id);

    return res.status(200).json({
      status: 'success',
      message: 'Email verified successfully',
    });

  } catch (err) {
    console.error('verifyEmail error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to verify email',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
};